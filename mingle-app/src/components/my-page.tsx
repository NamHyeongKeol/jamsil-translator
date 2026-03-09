"use client";

import type { AppDictionary } from "@/i18n/types";
import { useSession, signOut } from "next-auth/react";
import { useState, useRef, useCallback } from "react";
import BottomTabBar from "@/components/bottom-tab-bar";
import {
  Plus, Menu, Globe, LogOut, Trash2,
  Share2, Edit3, Camera, ChevronLeft,
} from "lucide-react";

// ── 로케일 → 국기 ────────────────────────────────────────────────────────
const LOCALE_FLAG: Record<string, string> = {
  ko: "🇰🇷", ja: "🇯🇵", en: "🇺🇸", zh: "🇨🇳", "zh-CN": "🇨🇳", "zh-TW": "🇹🇼",
  fr: "🇫🇷", de: "🇩🇪", es: "🇪🇸", pt: "🇧🇷", it: "🇮🇹",
  ru: "🇷🇺", ar: "🇸🇦", hi: "🇮🇳", th: "🇹🇭", vi: "🇻🇳",
};
function localeToFlag(l: string) { return LOCALE_FLAG[l] ?? "🌐"; }
const UNIQUE_FLAGS = Array.from(new Set(Object.values(LOCALE_FLAG)));
const DUMMY_POSTS: { id: number; color: string }[] = [];

// ── 공통 헤더 (오른쪽 슬라이드 패널 상단) ────────────────────────────────
function PanelHeader({
  title, onBack, backLabel, rightLabel, onRight,
}: {
  title: string; onBack: () => void;
  backLabel: string;
  rightLabel?: string; onRight?: () => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center border-b border-gray-100 px-4"
      style={{
        paddingTop: "env(safe-area-inset-top, 44px)",
        height: "calc(52px + env(safe-area-inset-top, 44px))",
      }}
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

// ── 스와이프-백 래퍼 ──────────────────────────────────────────────────────
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

// ── FullPanel: 오른쪽에서 슬라이드, mount/unmount 기반 ────────────────────
function FullPanel({ open, children, onClose }: {
  open: boolean; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 z-50 transition-transform duration-300 ease-in-out"
      style={{
        transform: open ? "translateX(0)" : "translateX(100%)",
        pointerEvents: open ? "auto" : "none",
      }}
      aria-hidden={!open}
    >
      <SwipeBack onBack={onClose}>{children}</SwipeBack>
    </div>
  );
}

// ── 설정 패널 (햄버거 메뉴 → 오른쪽 슬라이드) ──────────────────────────
function SettingsPanel({
  open,
  onClose,
  onLogout,
  onDeleteAccount,
  onLanguage,
  dictionary,
}: {
  open: boolean; onClose: () => void;
  onLogout: () => void; onDeleteAccount: () => void; onLanguage: () => void;
  dictionary: AppDictionary;
}) {
  return (
    <FullPanel open={open} onClose={onClose}>
      <PanelHeader
        title={dictionary.profile.menuLabel}
        onBack={onClose}
        backLabel={dictionary.myPage.backButtonLabel}
      />
      <div className="flex-1 overflow-y-auto">
        <button type="button" onClick={onLanguage}
          className="flex w-full items-center gap-4 px-5 py-4 text-left text-[15px] font-medium text-slate-800 transition hover:bg-gray-50 active:bg-gray-100">
          <Globe size={20} className="text-slate-500" /> {dictionary.myPage.languageSettings}
        </button>
        <div className="mx-5 h-px bg-gray-100" />
        <button type="button" onClick={onLogout}
          className="flex w-full items-center gap-4 px-5 py-4 text-left text-[15px] font-medium text-slate-800 transition hover:bg-gray-50 active:bg-gray-100">
          <LogOut size={20} className="text-slate-500" /> {dictionary.profile.logout}
        </button>
        <div className="mx-5 h-px bg-gray-100" />
        <button type="button" onClick={onDeleteAccount}
          className="flex w-full items-center gap-4 px-5 py-4 text-left text-[15px] font-medium text-red-500 transition hover:bg-red-50 active:bg-red-100">
          <Trash2 size={20} /> {dictionary.profile.deleteAccount}
        </button>
      </div>
    </FullPanel>
  );
}

// ── 팔로워/팔로잉 패널 ────────────────────────────────────────────────────
type FollowTab = "followers" | "following";
function FollowPanel({
  open,
  defaultTab,
  username,
  onClose,
  dictionary,
}: {
  open: boolean; defaultTab: FollowTab; username: string; onClose: () => void;
  dictionary: AppDictionary;
}) {
  const [tab, setTab] = useState<FollowTab>(defaultTab);

  return (
    <FullPanel open={open} onClose={onClose}>
      <PanelHeader
        title={username}
        onBack={onClose}
        backLabel={dictionary.myPage.backButtonLabel}
      />
      <div className="flex shrink-0 border-b border-gray-100">
        {(["followers", "following"] as FollowTab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className="flex-1 py-3 text-[14px] font-semibold"
            style={{
              borderBottom: tab === t ? "2px solid #111827" : "2px solid transparent",
              color: tab === t ? "#111827" : "#9ca3af",
            }}>
            {t === "followers"
              ? dictionary.profile.followersLabel
              : dictionary.profile.followingLabel}
          </button>
        ))}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-gray-400">
        <span className="text-4xl">👤</span>
        <p className="text-[14px]">
          {tab === "followers"
            ? dictionary.myPage.noFollowers
            : dictionary.myPage.noFollowing}
        </p>
      </div>
    </FullPanel>
  );
}

// ── 프로필 편집 패널 ─────────────────────────────────────────────────────
function EditProfilePanel({
  open,
  username,
  bio,
  flag,
  onClose,
  onSave,
  dictionary,
}: {
  open: boolean; username: string; bio: string; flag: string;
  onClose: () => void; onSave: (d: { username: string; bio: string; flag: string }) => void;
  dictionary: AppDictionary;
}) {
  const [lu, setLu] = useState(username);
  const [lb, setLb] = useState(bio);
  const [lf, setLf] = useState(flag);

  return (
    <FullPanel open={open} onClose={onClose}>
      <PanelHeader
        title={dictionary.myPage.editProfileTitle}
        onBack={onClose}
        backLabel={dictionary.myPage.cancelAction}
        rightLabel={dictionary.myPage.doneAction}
        onRight={() => { onSave({ username: lu, bio: lb, flag: lf }); onClose(); }}
      />
      <div className="flex-1 overflow-y-auto">
        {/* 사진 */}
        <div className="flex flex-col items-center py-5">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-200">
            <Camera size={28} className="text-gray-400" />
          </div>
          <span className="mt-2 text-[13px] font-semibold text-blue-500">
            {dictionary.myPage.changePhotoAction}
          </span>
        </div>
        <div className="space-y-4 px-5 pb-10">
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-gray-500">
              {dictionary.myPage.usernameLabel}
            </label>
            <input type="text" value={lu} onChange={(e) => setLu(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[15px] outline-none focus:border-gray-400"
              placeholder={dictionary.myPage.usernamePlaceholder} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-gray-500">
              {dictionary.myPage.bioLabel}
            </label>
            <input type="text" value={lb} onChange={(e) => setLb(e.target.value)} maxLength={60}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[15px] outline-none focus:border-gray-400"
              placeholder={dictionary.myPage.bioPlaceholder} />
          </div>
          <div>
            <label className="mb-2 block text-[12px] font-semibold text-gray-500">
              {dictionary.myPage.nationalityLabel}
            </label>
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

// ── 메인 ────────────────────────────────────────────────────────────────
export default function MyPage({
  locale,
  dictionary,
}: {
  locale: string;
  dictionary: AppDictionary;
}) {
  const { data: session } = useSession();
  const user = session?.user;

  const [showSettings, setShowSettings] = useState(false);
  const [followState, setFollowState] = useState<{ open: boolean; tab: FollowTab }>({ open: false, tab: "followers" });
  const [showEdit, setShowEdit] = useState(false);
  const [customUsername, setCustomUsername] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [customFlag, setCustomFlag] = useState<string | null>(null);
  const postsRef = useRef<HTMLDivElement>(null);
  const username = customUsername ?? user?.name ?? dictionary.myPage.anonymousUser;
  const flag = customFlag ?? localeToFlag(locale);

  const handleSignOut = useCallback(async () => {
    setShowSettings(false);
    await signOut({ callbackUrl: `/${locale}` });
  }, [locale]);

  return (
    // 핵심: relative + overflow-hidden → 자식 absolute 요소가 이 박스 안에 갇힘
    <main className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-white text-slate-900">

      {/* ── 슬라이딩 패널들 (조건부 마운트 → overflow 이슈 완전 제거) ── */}
      <SettingsPanel
        open={showSettings} onClose={() => setShowSettings(false)}
        onLogout={handleSignOut}
        onDeleteAccount={() => setShowSettings(false)}
        onLanguage={() => setShowSettings(false)}
        dictionary={dictionary}
      />
      <FollowPanel
        key={followState.open ? `follow-${followState.tab}` : "follow-closed"}
        open={followState.open} defaultTab={followState.tab} username={username}
        onClose={() => setFollowState((s) => ({ ...s, open: false }))}
        dictionary={dictionary}
      />
      <EditProfilePanel
        key={showEdit ? `edit-${username}-${bio}-${flag}` : "edit-closed"}
        open={showEdit} username={username} bio={bio} flag={flag}
        onClose={() => setShowEdit(false)}
        onSave={(d) => { setCustomUsername(d.username); setBio(d.bio); setCustomFlag(d.flag); }}
        dictionary={dictionary}
      />

      {/* ── 상단 헤더 ── */}
      <header className="flex shrink-0 items-center px-4"
        style={{ paddingTop: "env(safe-area-inset-top, 44px)", height: "calc(52px + env(safe-area-inset-top, 44px))" }}>
        <button type="button" aria-label={dictionary.myPage.addPostButtonLabel}
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
        <section className="px-4 pb-4 pt-3">
          {/* 프로필 사진 + 통계 */}
          <div className="flex items-center gap-5">
            <div className="relative shrink-0">
              <div className="h-[82px] w-[82px] overflow-hidden rounded-full bg-gray-200 ring-2 ring-gray-100">
                {user?.image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img
                    src={user.image}
                    alt={dictionary.myPage.profileImageAlt}
                    className="h-full w-full object-cover"
                  />
                  : <div className="flex h-full w-full items-center justify-center">
                    <svg width="46" height="46" viewBox="0 0 46 46" fill="none">
                      <circle cx="23" cy="17" r="10" fill="#9ca3af" />
                      <path d="M3 43c0-11.046 8.954-20 20-20s20 8.954 20 20" fill="#9ca3af" />
                    </svg>
                  </div>}
              </div>
              <span className="absolute bottom-0 left-0 flex h-[26px] w-[26px] items-center justify-center rounded-full border-[2.5px] border-white bg-white text-[15px] shadow-sm">
                {flag}
              </span>
            </div>
            <div className="flex flex-1 justify-around">
              <button type="button" onClick={() => postsRef.current?.scrollIntoView({ behavior: "smooth" })}
                className="flex flex-col items-center gap-0.5 transition active:opacity-60">
                <span className="text-[18px] font-bold leading-tight">{DUMMY_POSTS.length}</span>
                <span className="text-[12px] text-gray-500">{dictionary.profile.postsLabel}</span>
              </button>
              <button type="button" onClick={() => setFollowState({ open: true, tab: "followers" })}
                className="flex flex-col items-center gap-0.5 transition active:opacity-60">
                <span className="text-[18px] font-bold leading-tight">0</span>
                <span className="text-[12px] text-gray-500">{dictionary.profile.followersLabel}</span>
              </button>
              <button type="button" onClick={() => setFollowState({ open: true, tab: "following" })}
                className="flex flex-col items-center gap-0.5 transition active:opacity-60">
                <span className="text-[18px] font-bold leading-tight">0</span>
                <span className="text-[12px] text-gray-500">{dictionary.profile.followingLabel}</span>
              </button>
            </div>
          </div>

          {/* bio */}
          <p className="mt-3 text-[14px] leading-snug text-slate-800">
            {bio || <span className="text-gray-400">{dictionary.myPage.addBioPrompt}</span>}
          </p>

          {/* 버튼 */}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setShowEdit(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-100 py-[9px] text-[14px] font-semibold transition active:bg-gray-200">
              <Edit3 size={15} /> {dictionary.profile.editProfile}
            </button>
            <button type="button"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-100 py-[9px] text-[14px] font-semibold transition active:bg-gray-200">
              <Share2 size={15} /> {dictionary.profile.shareProfile}
            </button>
          </div>
        </section>

        {/* 그리드 탭 */}
        <div className="flex border-t border-gray-200">
          <div className="flex flex-1 justify-center py-3">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="#111827">
              <rect x="1" y="1" width="9" height="9" rx="1" />
              <rect x="14" y="1" width="9" height="9" rx="1" />
              <rect x="1" y="14" width="9" height="9" rx="1" />
              <rect x="14" y="14" width="9" height="9" rx="1" />
            </svg>
          </div>
        </div>

        {/* 게시물 */}
        <div ref={postsRef}>
          {DUMMY_POSTS.length === 0 ? (
            <div className="flex flex-col items-center py-14 text-gray-400">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full border-2 border-gray-300">
                <Plus size={28} />
              </div>
              <p className="text-[15px] font-semibold text-slate-700">
                {dictionary.myPage.sharePostsTitle}
              </p>
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
