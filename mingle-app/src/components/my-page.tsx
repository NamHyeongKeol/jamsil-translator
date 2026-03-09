"use client";

import type { AppDictionary } from "@/i18n/types";
import type { AppLocale } from "@/i18n";
import { useSession, signOut } from "next-auth/react";
import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import BottomTabBar from "@/components/bottom-tab-bar";
import { normalizeAppLocale, resolveAppLocale } from "@/lib/app-locale";
import {
  Plus, Menu, Globe, LogOut, Trash2,
  Share2, Edit3, Camera, ChevronLeft, ChevronRight,
} from "lucide-react";

// ── 로케일 → 국기 ────────────────────────────────────────────────────────
const LOCALE_FLAG: Record<string, string> = {
  ko: "🇰🇷", ja: "🇯🇵", en: "🇺🇸", zh: "🇨🇳", "zh-CN": "🇨🇳", "zh-TW": "🇹🇼",
  fr: "🇫🇷", de: "🇩🇪", es: "🇪🇸", pt: "🇧🇷", it: "🇮🇹",
  ru: "🇷🇺", ar: "🇸🇦", hi: "🇮🇳", th: "🇹🇭", vi: "🇻🇳",
};
const LANGUAGE_OPTIONS: ReadonlyArray<{ locale: AppLocale; label: string; flag: string }> = [
  { locale: "ko", label: "한국어", flag: "🇰🇷" },
  { locale: "ja", label: "日本語", flag: "🇯🇵" },
  { locale: "en", label: "English", flag: "🇺🇸" },
  { locale: "zh-CN", label: "中文(简体)", flag: "🇨🇳" },
  { locale: "zh-TW", label: "中文(繁體)", flag: "🇹🇼" },
  { locale: "fr", label: "Français", flag: "🇫🇷" },
  { locale: "de", label: "Deutsch", flag: "🇩🇪" },
  { locale: "es", label: "Español", flag: "🇪🇸" },
  { locale: "pt", label: "Português", flag: "🇧🇷" },
  { locale: "it", label: "Italiano", flag: "🇮🇹" },
  { locale: "ru", label: "Русский", flag: "🇷🇺" },
  { locale: "ar", label: "العربية", flag: "🇸🇦" },
  { locale: "hi", label: "हिन्दी", flag: "🇮🇳" },
  { locale: "th", label: "ภาษาไทย", flag: "🇹🇭" },
  { locale: "vi", label: "Tiếng Việt", flag: "🇻🇳" },
];
function localeToFlag(l: string) { return LOCALE_FLAG[l] ?? "🌐"; }
function getLanguageOption(locale: string | null | undefined) {
  const normalizedLocale = normalizeAppLocale(locale);
  if (!normalizedLocale) return null;
  return LANGUAGE_OPTIONS.find((option) => option.locale === normalizedLocale) ?? null;
}
const UNIQUE_FLAGS = Array.from(new Set(Object.values(LOCALE_FLAG)));
const DUMMY_POSTS: { id: number; color: string }[] = [];

// ── 프로필 아바타 + 국기 배지 컴포넌트 (하나로 통합) ─────────────────────
function ProfileAvatarBadge({
  imageUrl, altText, flag, size = 86,
}: {
  imageUrl?: string | null; altText: string; flag: string; size?: number;
}) {
  const badgeSize = Math.round(size * 0.32);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="overflow-hidden rounded-full bg-gray-200" style={{ width: size, height: size }}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={altText} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 46 46" fill="none">
              <circle cx="23" cy="17" r="10" fill="#9ca3af" />
              <path d="M3 43c0-11.046 8.954-20 20-20s20 8.954 20 20" fill="#9ca3af" />
            </svg>
          </div>
        )}
      </div>
      <span
        className="absolute flex items-center justify-center rounded-full border-2 border-white bg-white shadow-sm"
        style={{ width: badgeSize, height: badgeSize, bottom: -2, left: -2, fontSize: badgeSize * 0.62, lineHeight: 1 }}
      >
        {flag}
      </span>
    </div>
  );
}

// ── 공통 헤더 ─────────────────────────────────────────────────────────────
function PanelHeader({ title, onBack, backLabel, rightLabel, onRight }: {
  title: string; onBack: () => void; backLabel: string;
  rightLabel?: string; onRight?: () => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center border-b border-gray-100 px-4"
      style={{ paddingTop: "env(safe-area-inset-top, 44px)", height: "calc(52px + env(safe-area-inset-top, 44px))" }}
    >
      <button type="button" onClick={onBack} aria-label={backLabel}
        className="flex h-10 w-10 items-center justify-center rounded-full transition active:bg-gray-100">
        <ChevronLeft size={24} />
      </button>
      <span className="mx-auto text-[16px] font-semibold">{title}</span>
      {rightLabel && onRight
        ? <button type="button" onClick={onRight} className="text-[15px] font-semibold text-blue-500">{rightLabel}</button>
        : <div className="w-10" />}
    </div>
  );
}

// ── 스와이프-백 ───────────────────────────────────────────────────────────
function SwipeBack({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  const startX = useRef<number | null>(null);
  return (
    <div
      className="absolute inset-0 flex flex-col bg-white"
      onTouchStart={(e) => { startX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (startX.current !== null && e.changedTouches[0].clientX - startX.current > 60) onBack();
        startX.current = null;
      }}
    >
      {children}
    </div>
  );
}

// ── FullPanel: 오른쪽 슬라이드 ────────────────────────────────────────────
function FullPanel({ open, children, onClose, zIndex = 50 }: {
  open: boolean; onClose: () => void; children: React.ReactNode; zIndex?: number;
}) {
  return (
    <div
      className="absolute inset-0 transition-transform duration-300 ease-in-out"
      style={{
        transform: open ? "translateX(0)" : "translateX(100%)",
        pointerEvents: open ? "auto" : "none",
        zIndex,
      }}
      aria-hidden={!open}
    >
      <SwipeBack onBack={onClose}>{children}</SwipeBack>
    </div>
  );
}

// ── 준비중 모달 ───────────────────────────────────────────────────────────
function ComingSoonModal({
  open,
  onClose,
  dictionary,
}: {
  open: boolean;
  onClose: () => void;
  dictionary: AppDictionary;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[280px] rounded-2xl bg-white p-6 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[16px] font-semibold text-slate-900">{dictionary.myPage.comingSoonTitle}</p>
        <p className="mt-1 text-[13px] text-gray-500">{dictionary.myPage.comingSoonDescription}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-slate-900 py-2.5 text-[15px] font-semibold text-white transition active:bg-slate-700"
        >
          {dictionary.myPage.confirmAction}
        </button>
      </div>
    </div>
  );
}

// ── 회원탈퇴 확인 모달 ────────────────────────────────────────────────────
function DeleteAccountModal({ open, onClose, onConfirm, loading, dictionary }: {
  open: boolean; onClose: () => void; onConfirm: () => void; loading: boolean; dictionary: AppDictionary;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[280px] rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[16px] font-semibold text-slate-900">{dictionary.profile.deleteAccount}</p>
        <p className="mt-1 text-[13px] text-gray-500">{dictionary.profile.deleteAccountConfirm}</p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose}
            className="flex-1 rounded-xl border border-gray-200 bg-gray-100 py-2.5 text-[15px] font-semibold text-slate-700 transition active:bg-gray-200">
            {dictionary.profile.deleteAccountCancel}
          </button>
          <button type="button" onClick={onConfirm} disabled={loading}
            className="flex-1 rounded-xl bg-red-500 py-2.5 text-[15px] font-semibold text-white transition active:bg-red-600 disabled:opacity-60">
            {dictionary.profile.deleteAccountConfirmAction}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 언어 설정 패널 (설정 패널에서 한 뎁스 더 오른쪽) ─────────────────────
function LanguagePanel({ open, onClose, currentLocale, onSelect, dictionary }: {
  open: boolean; onClose: () => void;
  currentLocale: AppLocale; onSelect: (locale: AppLocale) => void;
  dictionary: AppDictionary;
}) {
  return (
    <FullPanel open={open} onClose={onClose} zIndex={60}>
      <PanelHeader
        title={dictionary.myPage.languageSettings}
        onBack={onClose}
        backLabel={dictionary.myPage.backButtonLabel}
      />
      <div className="flex-1 overflow-y-auto">
        {LANGUAGE_OPTIONS.map((opt, idx) => (
          <div key={opt.locale}>
            <button
              type="button"
              onClick={() => onSelect(opt.locale)}
              className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-gray-50 active:bg-gray-100"
            >
              <span className="text-2xl">{opt.flag}</span>
              <span className="flex-1 text-[15px] font-medium text-slate-800">{opt.label}</span>
              {currentLocale === opt.locale && (
                <svg viewBox="0 0 20 20" fill="none" width="20" height="20">
                  <path d="M4 10l4 4 8-8" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            {idx < LANGUAGE_OPTIONS.length - 1 && <div className="mx-5 h-px bg-gray-100" />}
          </div>
        ))}
      </div>
    </FullPanel>
  );
}

// ── 설정 패널 ─────────────────────────────────────────────────────────────
function SettingsPanel({
  open, onClose, onLogout, onDeleteAccount, onLanguage, selectedLanguage, dictionary,
}: {
  open: boolean; onClose: () => void;
  onLogout: () => void; onDeleteAccount: () => void; onLanguage: () => void;
  selectedLanguage: { flag: string; label: string } | null;
  dictionary: AppDictionary;
}) {
  return (
    <FullPanel open={open} onClose={onClose} zIndex={50}>
      <PanelHeader
        title={dictionary.profile.menuLabel}
        onBack={onClose}
        backLabel={dictionary.myPage.backButtonLabel}
      />
      <div className="flex-1 overflow-y-auto">
        {/* 언어 설정 - 오른쪽 화살표 */}
        <button type="button" onClick={onLanguage}
          className="flex w-full items-center px-6 py-4 text-left transition hover:bg-gray-50 active:bg-gray-100">
          <div className="flex min-w-0 flex-1 items-center">
            <span className="mr-4 inline-flex h-6 w-6 shrink-0 items-center justify-center">
              <Globe size={20} className="text-slate-500" />
            </span>
            <span className="flex-1 text-[15px] font-medium text-slate-800">{dictionary.myPage.languageSettings}</span>
          </div>
          {selectedLanguage && (
            <span className="flex items-center gap-2 text-[13px] text-slate-500">
              <span aria-hidden="true" className="text-base">{selectedLanguage.flag}</span>
              <span>{selectedLanguage.label}</span>
            </span>
          )}
          <ChevronRight size={18} className="shrink-0 text-gray-400" />
        </button>
        <div className="mx-6 h-px bg-gray-100" />
        {/* 로그아웃 */}
        <button type="button" onClick={onLogout}
          className="flex w-full items-center px-6 py-4 text-left transition hover:bg-gray-50 active:bg-gray-100">
          <span className="mr-4 inline-flex h-6 w-6 shrink-0 items-center justify-center">
            <LogOut size={20} className="text-slate-500" />
          </span>
          <span className="flex-1 text-[15px] font-medium text-slate-800">{dictionary.profile.logout}</span>
        </button>
        <div className="mx-6 h-px bg-gray-100" />
        {/* 회원탈퇴 */}
        <button type="button" onClick={onDeleteAccount}
          className="flex w-full items-center px-6 py-4 text-left transition hover:bg-red-50 active:bg-red-100">
          <span className="mr-4 inline-flex h-6 w-6 shrink-0 items-center justify-center">
            <Trash2 size={20} className="text-red-500" />
          </span>
          <span className="flex-1 text-[15px] font-medium text-red-500">{dictionary.profile.deleteAccount}</span>
        </button>
      </div>
    </FullPanel>
  );
}

// ── 팔로워/팔로잉 패널 ────────────────────────────────────────────────────
type FollowTab = "followers" | "following";
function FollowPanel({ open, defaultTab, username, onClose, dictionary }: {
  open: boolean; defaultTab: FollowTab; username: string; onClose: () => void;
  dictionary: AppDictionary;
}) {
  const [tab, setTab] = useState<FollowTab>(defaultTab);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (open) setTab(defaultTab); }, [open, defaultTab]);

  return (
    <FullPanel open={open} onClose={onClose} zIndex={50}>
      <PanelHeader title={username} onBack={onClose} backLabel={dictionary.myPage.backButtonLabel} />
      <div className="flex shrink-0 border-b border-gray-100">
        {(["followers", "following"] as FollowTab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className="flex-1 py-3 text-[14px] font-semibold"
            style={{ borderBottom: tab === t ? "2px solid #111827" : "2px solid transparent", color: tab === t ? "#111827" : "#9ca3af" }}>
            {t === "followers" ? dictionary.profile.followersLabel : dictionary.profile.followingLabel}
          </button>
        ))}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-gray-400">
        <span className="text-4xl">👤</span>
        <p className="text-[14px]">{tab === "followers" ? dictionary.myPage.noFollowers : dictionary.myPage.noFollowing}</p>
      </div>
    </FullPanel>
  );
}

// ── 프로필 편집 패널 ─────────────────────────────────────────────────────
function EditProfilePanel({ open, username, bio, flag, onClose, onSave, dictionary }: {
  open: boolean; username: string; bio: string; flag: string;
  onClose: () => void; onSave: (d: { username: string; bio: string; flag: string }) => void;
  dictionary: AppDictionary;
}) {
  const [lu, setLu] = useState(username);
  const [lb, setLb] = useState(bio);
  const [lf, setLf] = useState(flag);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (open) { setLu(username); setLb(bio); setLf(flag); } }, [open, username, bio, flag]);

  return (
    <FullPanel open={open} onClose={onClose} zIndex={50}>
      <PanelHeader
        title={dictionary.myPage.editProfileTitle}
        onBack={onClose}
        backLabel={dictionary.myPage.cancelAction}
        rightLabel={dictionary.myPage.doneAction}
        onRight={() => { onSave({ username: lu, bio: lb, flag: lf }); onClose(); }}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center py-5">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-200">
            <Camera size={28} className="text-gray-400" />
          </div>
          <span className="mt-2 text-[13px] font-semibold text-blue-500">{dictionary.myPage.changePhotoAction}</span>
        </div>
        <div className="space-y-4 px-5 pb-10">
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-gray-500">{dictionary.myPage.usernameLabel}</label>
            <input type="text" value={lu} onChange={(e) => setLu(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[15px] outline-none focus:border-gray-400"
              placeholder={dictionary.myPage.usernamePlaceholder} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-gray-500">{dictionary.myPage.bioLabel}</label>
            <input type="text" value={lb} onChange={(e) => setLb(e.target.value)} maxLength={60}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[15px] outline-none focus:border-gray-400"
              placeholder={dictionary.myPage.bioPlaceholder} />
          </div>
          <div>
            <label className="mb-2 block text-[12px] font-semibold text-gray-500">{dictionary.myPage.nationalityLabel}</label>
            <div className="flex flex-wrap gap-2">
              {UNIQUE_FLAGS.map((f) => (
                <button key={f} type="button" onClick={() => setLf(f)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border-2 text-2xl transition"
                  style={{ borderColor: lf === f ? "#f59e0b" : "transparent", background: lf === f ? "#fef3c7" : "#f3f4f6" }}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </FullPanel>
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────
export default function MyPage({ locale, dictionary }: { locale: AppLocale; dictionary: AppDictionary }) {
  const { data: session } = useSession();
  const user = session?.user;

  const [showSettings, setShowSettings] = useState(false);
  const [showLanguage, setShowLanguage] = useState(false);
  const [followState, setFollowState] = useState<{ open: boolean; tab: FollowTab }>({ open: false, tab: "followers" });
  const [showEdit, setShowEdit] = useState(false);
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [customUsername, setCustomUsername] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  // customFlag: 프로필 편집에서 수동 지정한 국기 (언어 설정과 완전 별개)
  const [customFlag, setCustomFlag] = useState<string | null>(null);
  const [selectedLocale, setSelectedLocale] = useState<AppLocale>(() => resolveAppLocale(locale));

  const postsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const username = customUsername ?? user?.name ?? dictionary.myPage.anonymousUser;
  // flag: customFlag(프로필 편집에서 설정) or 현재 locale 기반 (언어 설정과 무관)
  const flag = customFlag ?? localeToFlag(locale);
  const selectedLanguage = getLanguageOption(selectedLocale);

  // DB에서 프로필 초기값 로드
  useEffect(() => {
    fetch("/api/profile")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return;
        if (data.displayName) setCustomUsername(data.displayName);
        if (data.bio) setBio(data.bio);
        if (data.nationality) setCustomFlag(localeToFlag(data.nationality));
        if (data.appLocale) setSelectedLocale(resolveAppLocale(data.appLocale, locale));
      })
      .catch(() => {});
  }, [locale]);

  const handleSignOut = useCallback(async () => {
    setShowSettings(false);
    await signOut({ callbackUrl: `/${locale}` });
  }, [locale]);

  const handleDeleteAccount = useCallback(async () => {
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" });
      if (res.ok) {
        await signOut({ callbackUrl: `/${locale}` });
      }
    } catch {
      // silent
    } finally {
      setDeleteLoading(false);
      setShowDeleteConfirm(false);
    }
  }, [locale]);

  // 언어 설정: locale 변경 = URL prefix 교체 + DB에 appLocale 저장
  const handleLanguageSelect = useCallback((newLocale: AppLocale) => {
    setShowLanguage(false);
    const normalizedLocale = resolveAppLocale(newLocale, locale);
    setSelectedLocale(normalizedLocale);

    // DB에 appLocale 저장 (비동기)
    fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appLocale: normalizedLocale }),
    }).catch(() => {});

    if (normalizedLocale !== locale) {
      const newPath = pathname.replace(new RegExp(`^/${locale}(/|$)`), `/${normalizedLocale}$1`);
      router.push(newPath);
    }
  }, [locale, pathname, router]);

  return (
    <main className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-white text-slate-900">

      {/* ── 전역 모달 ── */}
      <ComingSoonModal
        open={showComingSoon}
        onClose={() => setShowComingSoon(false)}
        dictionary={dictionary}
      />
      <DeleteAccountModal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteAccount}
        loading={deleteLoading}
        dictionary={dictionary}
      />

      {/* ── 슬라이딩 패널 ── */}
      <SettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onLogout={handleSignOut}
        onDeleteAccount={() => { setShowSettings(false); setShowDeleteConfirm(true); }}
        onLanguage={() => setShowLanguage(true)}
        selectedLanguage={selectedLanguage}
        dictionary={dictionary}
      />
      {/* 언어 설정 패널: 설정 위에 z-60으로 쌓임 */}
      <LanguagePanel
        open={showLanguage}
        onClose={() => setShowLanguage(false)}
        currentLocale={selectedLocale}
        onSelect={handleLanguageSelect}
        dictionary={dictionary}
      />
      <FollowPanel
        open={followState.open} defaultTab={followState.tab} username={username}
        onClose={() => setFollowState((s) => ({ ...s, open: false }))}
        dictionary={dictionary}
      />
      <EditProfilePanel
        open={showEdit} username={username} bio={bio} flag={flag}
        onClose={() => setShowEdit(false)}
        onSave={async (d) => {
          // 로컸 상태 먼저 업데이트 (낙관적 UI)
          setCustomUsername(d.username);
          setBio(d.bio);
          setCustomFlag(d.flag);
          // DB에 먹는 nationality는 flag → locale지도에서 역습 필요
          // flag 이모지 → 로케일 법 (LOCALE_FLAG invert)
          const natEntry = Object.entries(LOCALE_FLAG).find(([, v]) => v === d.flag);
          const nationality = natEntry ? natEntry[0] : null;
          await fetch("/api/profile", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              displayName: d.username,
              bio: d.bio,
              nationality,
            }),
          });
        }}
        dictionary={dictionary}
      />

      {/* ── 상단 헤더 ── */}
      <header
        className="flex shrink-0 items-center px-4"
        style={{ paddingTop: "env(safe-area-inset-top, 44px)", height: "calc(52px + env(safe-area-inset-top, 44px))" }}
      >
        <button type="button" aria-label={dictionary.myPage.addPostButtonLabel} onClick={() => setShowComingSoon(true)}
          className="flex h-9 w-9 items-center justify-center rounded-full transition active:bg-gray-100">
          <Plus size={24} strokeWidth={2} />
        </button>
        <span className="mx-auto text-[17px] font-bold">{username}</span>
        <button type="button" onClick={() => setShowSettings(true)} aria-label={dictionary.profile.menuLabel}
          className="flex h-9 w-9 items-center justify-center rounded-full transition active:bg-gray-100">
          <Menu size={22} strokeWidth={2} />
        </button>
      </header>

      {/* ── 스크롤 본문 ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="px-4 pb-3 pt-4">
          {/* 프로필 사진 + 통계 (인스타 레이아웃) */}
          <div className="flex items-center">
            <ProfileAvatarBadge
              imageUrl={user?.image}
              altText={dictionary.myPage.profileImageAlt}
              flag={flag}
              size={86}
            />
            <div className="ml-8 flex flex-1 items-stretch justify-around">
              <button type="button" onClick={() => postsRef.current?.scrollIntoView({ behavior: "smooth" })}
                className="flex flex-col items-center justify-center gap-0.5 px-2 py-1 transition active:opacity-60">
                <span className="text-[18px] font-semibold leading-tight">{DUMMY_POSTS.length}</span>
                <span className="text-[12px] text-gray-500">{dictionary.profile.postsLabel}</span>
              </button>
              <button type="button" onClick={() => setFollowState({ open: true, tab: "followers" })}
                className="flex flex-col items-center justify-center gap-0.5 px-2 py-1 transition active:opacity-60">
                <span className="text-[18px] font-semibold leading-tight">0</span>
                <span className="text-[12px] text-gray-500">{dictionary.profile.followersLabel}</span>
              </button>
              <button type="button" onClick={() => setFollowState({ open: true, tab: "following" })}
                className="flex flex-col items-center justify-center gap-0.5 px-2 py-1 transition active:opacity-60">
                <span className="text-[18px] font-semibold leading-tight">0</span>
                <span className="text-[12px] text-gray-500">{dictionary.profile.followingLabel}</span>
              </button>
            </div>
          </div>

          {/* bio (id 없이 바로 소개) */}
          {bio
            ? <p className="mt-3 text-[14px] leading-snug text-slate-800">{bio}</p>
            : <p className="mt-3 text-[14px] text-gray-400">{dictionary.myPage.addBioPrompt}</p>}

          {/* 프로필 편집 / 공유 버튼 */}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setShowEdit(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-100 py-[10px] text-[13px] font-semibold transition active:bg-gray-200">
              <Edit3 size={14} /> {dictionary.profile.editProfile}
            </button>
            <button type="button" onClick={() => setShowComingSoon(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-100 py-[10px] text-[13px] font-semibold transition active:bg-gray-200">
              <Share2 size={14} /> {dictionary.profile.shareProfile}
            </button>
          </div>
        </section>
        <div className="mb-4" />

        {/* 게시물 그리드 (그리드 아이콘 탭바 없음) */}
        <div className="border-t border-gray-200" ref={postsRef}>
          {DUMMY_POSTS.length === 0 ? (
            <div className="flex flex-col items-center py-14 text-gray-400">
              <button
                type="button"
                onClick={() => setShowComingSoon(true)}
                className="mb-3 flex h-14 w-14 items-center justify-center rounded-full border-2 border-gray-300 transition active:bg-gray-50"
              >
                <Plus size={28} />
              </button>
              <p className="text-[15px] font-semibold text-slate-700">{dictionary.myPage.sharePostsTitle}</p>
              <p className="mt-1 text-[13px]">{dictionary.myPage.sharePostsDescription}</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-px">
              {DUMMY_POSTS.map((p) => <div key={p.id} className="aspect-[3/4]" style={{ background: p.color }} />)}
            </div>
          )}
        </div>
        <div className="h-6" />
      </div>

      <BottomTabBar locale={locale} dictionary={dictionary} />
    </main>
  );
}
