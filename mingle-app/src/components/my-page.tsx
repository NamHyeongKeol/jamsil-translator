"use client";

import { useSession, signOut } from "next-auth/react";
import { useState, useRef, useCallback } from "react";
import BottomTabBar from "@/components/bottom-tab-bar";
import {
  Plus,
  Menu,
  Globe,
  LogOut,
  Trash2,
  Share2,
  Edit3,
  Camera,
  ChevronLeft,
} from "lucide-react";

// ────────────────────────────────────────────────────────────────────────
// 로케일 → 국기 이모지
// ────────────────────────────────────────────────────────────────────────
const LOCALE_FLAG: Record<string, string> = {
  ko: "🇰🇷", ja: "🇯🇵", en: "🇺🇸", zh: "🇨🇳", "zh-TW": "🇹🇼",
  fr: "🇫🇷", de: "🇩🇪", es: "🇪🇸", pt: "🇧🇷", it: "🇮🇹",
  ru: "🇷🇺", ar: "🇸🇦", hi: "🇮🇳", th: "🇹🇭", vi: "🇻🇳",
};
function localeToFlag(locale: string) {
  return LOCALE_FLAG[locale] ?? "🌐";
}

// ────────────────────────────────────────────────────────────────────────
// 더미 게시물
// ────────────────────────────────────────────────────────────────────────
const DUMMY_POSTS: { id: number; color: string }[] = [];

// ────────────────────────────────────────────────────────────────────────
// 공통 Dim 배경 (absolute, 컨테이너 내부)
// ────────────────────────────────────────────────────────────────────────
function Dim({ show, onClick }: { show: boolean; onClick: () => void }) {
  return (
    <div
      className="absolute inset-0 z-40 transition-opacity duration-300"
      style={{
        background: "rgba(0,0,0,0.4)",
        opacity: show ? 1 : 0,
        pointerEvents: show ? "auto" : "none",
      }}
      onClick={onClick}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────
// 햄버거 메뉴 바텀시트 (absolute, 아래서 슬라이드)
// ────────────────────────────────────────────────────────────────────────
function HamburgerSheet({
  open, onClose, onLogout, onDeleteAccount, onLanguage,
}: {
  open: boolean; onClose: () => void;
  onLogout: () => void; onDeleteAccount: () => void; onLanguage: () => void;
}) {
  return (
    <>
      <Dim show={open} onClick={onClose} />
      <div
        className="absolute bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-white transition-transform duration-300"
        style={{ transform: open ? "translateY(0)" : "translateY(100%)" }}
      >
        <div className="mx-auto mb-3 mt-3 h-1 w-10 rounded-full bg-gray-300" />
        <button type="button" onClick={onLanguage}
          className="flex w-full items-center gap-3 px-6 py-4 text-left text-[15px] font-medium text-slate-800 transition hover:bg-gray-50 active:bg-gray-100">
          <Globe size={20} className="text-slate-500" /> 언어 설정
        </button>
        <div className="mx-6 h-px bg-gray-100" />
        <button type="button" onClick={onLogout}
          className="flex w-full items-center gap-3 px-6 py-4 text-left text-[15px] font-medium text-slate-800 transition hover:bg-gray-50 active:bg-gray-100">
          <LogOut size={20} className="text-slate-500" /> 로그아웃
        </button>
        <div className="mx-6 h-px bg-gray-100" />
        <button type="button" onClick={onDeleteAccount}
          className="flex w-full items-center gap-3 px-6 py-4 text-left text-[15px] font-medium text-red-500 transition hover:bg-red-50 active:bg-red-100">
          <Trash2 size={20} /> 회원 탈퇴
        </button>
        <div style={{ height: "env(safe-area-inset-bottom, 20px)" }} />
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 팔로워/팔로잉 패널 (absolute, 오른쪽에서 슬라이드 — 전체 화면 덮음)
// ────────────────────────────────────────────────────────────────────────
type FollowTab = "followers" | "following";
function FollowPanel({
  open, defaultTab, username, onClose,
}: {
  open: boolean; defaultTab: FollowTab; username: string; onClose: () => void;
}) {
  const [tab, setTab] = useState<FollowTab>(defaultTab);
  const startXRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (startXRef.current === null) return;
    if (e.changedTouches[0].clientX - startXRef.current > 60) onClose();
    startXRef.current = null;
  };

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col bg-white transition-transform duration-300 ease-in-out"
      style={{ transform: open ? "translateX(0)" : "translateX(100%)" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 헤더 */}
      <div
        className="flex shrink-0 items-center border-b border-gray-100 px-4"
        style={{ paddingTop: "env(safe-area-inset-top, 44px)", height: "calc(52px + env(safe-area-inset-top, 44px))" }}
      >
        <button type="button" onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full transition active:bg-gray-100">
          <ChevronLeft size={24} />
        </button>
        <span className="mx-auto text-[15px] font-semibold">{username}</span>
        <div className="h-10 w-10" />
      </div>
      {/* 탭 */}
      <div className="flex shrink-0 border-b border-gray-100">
        {(["followers", "following"] as FollowTab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className="flex-1 py-3 text-[14px] font-semibold transition"
            style={{
              borderBottom: tab === t ? "2px solid #111827" : "2px solid transparent",
              color: tab === t ? "#111827" : "#9ca3af",
            }}>
            {t === "followers" ? "팔로워" : "팔로잉"}
          </button>
        ))}
      </div>
      {/* 빈 상태 */}
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-gray-400">
        <span className="text-4xl">👤</span>
        <p className="text-[14px]">{tab === "followers" ? "아직 팔로워가 없어요" : "아직 팔로잉이 없어요"}</p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 프로필 편집 시트 (absolute, 아래서 슬라이드 — 전체 화면 덮음)
// ────────────────────────────────────────────────────────────────────────
function EditProfileSheet({
  open, username, bio, flag, onClose, onSave,
}: {
  open: boolean; username: string; bio: string; flag: string;
  onClose: () => void; onSave: (d: { username: string; bio: string; flag: string }) => void;
}) {
  const [localUsername, setLocalUsername] = useState(username);
  const [localBio, setLocalBio] = useState(bio);
  const [localFlag, setLocalFlag] = useState(flag);

  const uniqueFlags = Array.from(new Set(Object.values(LOCALE_FLAG)));

  const handleSave = () => { onSave({ username: localUsername, bio: localBio, flag: localFlag }); onClose(); };

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col bg-white transition-transform duration-300"
      style={{ transform: open ? "translateY(0)" : "translateY(100%)" }}
    >
      {/* 헤더 */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4"
        style={{ paddingTop: "env(safe-area-inset-top, 44px)", height: "calc(52px + env(safe-area-inset-top, 44px))" }}
      >
        <button type="button" onClick={onClose} className="text-[15px] text-gray-500">취소</button>
        <span className="text-[16px] font-semibold">프로필 편집</span>
        <button type="button" onClick={handleSave} className="text-[15px] font-semibold text-blue-500">완료</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 사진 */}
        <div className="flex flex-col items-center py-5">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-200">
            <Camera size={28} className="text-gray-400" />
          </div>
          <span className="mt-2 text-[13px] font-semibold text-blue-500">사진 변경</span>
        </div>

        <div className="space-y-4 px-4 pb-8">
          <div>
            <label className="block text-[12px] font-semibold text-gray-500 mb-1">사용자 이름</label>
            <input type="text" value={localUsername} onChange={(e) => setLocalUsername(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[15px] outline-none focus:border-gray-400"
              placeholder="사용자 이름" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-gray-500 mb-1">소개</label>
            <input type="text" value={localBio} onChange={(e) => setLocalBio(e.target.value)} maxLength={60}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[15px] outline-none focus:border-gray-400"
              placeholder="한 줄 소개" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-gray-500 mb-1">국적</label>
            <div className="flex flex-wrap gap-2">
              {uniqueFlags.map((f) => (
                <button key={f} type="button" onClick={() => setLocalFlag(f)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border-2 text-2xl transition"
                  style={{ borderColor: localFlag === f ? "#f59e0b" : "transparent", background: localFlag === f ? "#fef3c7" : "#f3f4f6" }}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ────────────────────────────────────────────────────────────────────────
type MyPageProps = { locale: string };

export default function MyPage({ locale }: MyPageProps) {
  const { data: session } = useSession();
  const user = session?.user;

  const [showMenu, setShowMenu] = useState(false);
  const [followPanel, setFollowPanel] = useState<{ open: boolean; tab: FollowTab }>({ open: false, tab: "followers" });
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [username, setUsername] = useState(user?.name ?? "user");
  const [bio, setBio] = useState("");
  const [flag, setFlag] = useState(localeToFlag(locale));

  const postsRef = useRef<HTMLDivElement>(null);

  const handleSignOut = useCallback(async () => {
    setShowMenu(false);
    await signOut({ callbackUrl: `/${locale}` });
  }, [locale]);

  const handleScrollToPosts = useCallback(() => {
    postsRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleSaveProfile = useCallback(
    (data: { username: string; bio: string; flag: string }) => {
      setUsername(data.username); setBio(data.bio); setFlag(data.flag);
    }, [],
  );

  return (
    // relative + overflow-hidden 필수 → absolute 오버레이가 이 컨테이너 안에 갇힘
    <main className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-white text-slate-900">

      {/* ── 오버레이 레이어들 (absolute, 컨테이너 내부) ── */}
      <HamburgerSheet
        open={showMenu}
        onClose={() => setShowMenu(false)}
        onLogout={handleSignOut}
        onDeleteAccount={() => setShowMenu(false)}
        onLanguage={() => setShowMenu(false)}
      />
      <FollowPanel
        open={followPanel.open}
        defaultTab={followPanel.tab}
        username={username}
        onClose={() => setFollowPanel((p) => ({ ...p, open: false }))}
      />
      <EditProfileSheet
        open={showEditProfile}
        username={username}
        bio={bio}
        flag={flag}
        onClose={() => setShowEditProfile(false)}
        onSave={handleSaveProfile}
      />

      {/* ── 상단 헤더 ── */}
      <header
        className="flex shrink-0 items-center px-4"
        style={{
          paddingTop: "env(safe-area-inset-top, 44px)",
          height: "calc(52px + env(safe-area-inset-top, 44px))",
        }}
      >
        <button type="button" aria-label="게시물 추가"
          className="flex h-9 w-9 items-center justify-center rounded-full transition active:bg-gray-100">
          <Plus size={24} strokeWidth={2} />
        </button>
        <span className="mx-auto text-[17px] font-bold">{username}</span>
        <button type="button" onClick={() => setShowMenu(true)} aria-label="메뉴"
          className="flex h-9 w-9 items-center justify-center rounded-full transition active:bg-gray-100">
          <Menu size={22} strokeWidth={2} />
        </button>
      </header>

      {/* ── 스크롤 본문 ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 프로필 섹션 */}
        <section className="px-4 pb-4 pt-3">
          <div className="flex items-center gap-5">
            {/* 프로필 사진 */}
            <div className="relative shrink-0">
              <div className="h-[82px] w-[82px] overflow-hidden rounded-full bg-gray-200 ring-2 ring-gray-100">
                {user?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.image} alt="프로필" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <svg width="46" height="46" viewBox="0 0 46 46" fill="none">
                      <circle cx="23" cy="17" r="10" fill="#9ca3af" />
                      <path d="M3 43c0-11.046 8.954-20 20-20s20 8.954 20 20" fill="#9ca3af" />
                    </svg>
                  </div>
                )}
              </div>
              {/* 국기 배지 */}
              <span className="absolute bottom-0 left-0 flex h-[26px] w-[26px] items-center justify-center rounded-full border-[2.5px] border-white bg-white text-[15px] shadow-sm">
                {flag}
              </span>
            </div>

            {/* 통계 */}
            <div className="flex flex-1 justify-around">
              <button type="button" onClick={handleScrollToPosts}
                className="flex flex-col items-center gap-0.5 transition active:opacity-60">
                <span className="text-[18px] font-bold leading-tight">{DUMMY_POSTS.length}</span>
                <span className="text-[12px] text-gray-500">게시물</span>
              </button>
              <button type="button" onClick={() => setFollowPanel({ open: true, tab: "followers" })}
                className="flex flex-col items-center gap-0.5 transition active:opacity-60">
                <span className="text-[18px] font-bold leading-tight">0</span>
                <span className="text-[12px] text-gray-500">팔로워</span>
              </button>
              <button type="button" onClick={() => setFollowPanel({ open: true, tab: "following" })}
                className="flex flex-col items-center gap-0.5 transition active:opacity-60">
                <span className="text-[18px] font-bold leading-tight">0</span>
                <span className="text-[12px] text-gray-500">팔로잉</span>
              </button>
            </div>
          </div>

          {/* bio */}
          <p className="mt-3 text-[14px] leading-snug text-slate-800">
            {bio || <span className="text-gray-400">소개를 추가해보세요</span>}
          </p>

          {/* 버튼 행 */}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setShowEditProfile(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-100 py-[9px] text-[14px] font-semibold transition active:bg-gray-200">
              <Edit3 size={15} /> 프로필 편집
            </button>
            <button type="button"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-100 py-[9px] text-[14px] font-semibold transition active:bg-gray-200">
              <Share2 size={15} /> 프로필 공유
            </button>
          </div>
        </section>

        {/* 그리드 탭 구분선 */}
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

        {/* 게시물 그리드 */}
        <div ref={postsRef}>
          {DUMMY_POSTS.length === 0 ? (
            <div className="flex flex-col items-center py-14 text-gray-400">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full border-2 border-gray-300">
                <Plus size={28} className="text-gray-400" />
              </div>
              <p className="text-[15px] font-semibold text-slate-700">게시물 공유</p>
              <p className="mt-1 text-[13px] text-gray-400">사진과 영상을 공유해보세요</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-px">
              {DUMMY_POSTS.map((p) => <div key={p.id} className="aspect-[3/4]" style={{ background: p.color }} />)}
            </div>
          )}
        </div>
        <div className="h-6" />
      </div>

      {/* ── 하단 탭바 ── */}
      <BottomTabBar locale={locale} />
    </main>
  );
}
