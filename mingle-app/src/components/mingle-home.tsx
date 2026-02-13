"use client";

import Link from "next/link";
import {
  Filter,
  Grid3X3,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Smartphone,
  User,
  Users,
  Video,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import {
  createInviteToken,
  loadInviteRecords,
  loadSavedConversations,
  saveConversations,
  saveInviteRecords,
  type InviteRecord,
  type SavedConversation,
} from "@/lib/chat-invite-store";
import { detectMobileRuntime } from "@/lib/mobile-runtime";
import { getSeedDataset } from "@/lib/seed-data";
import type { AppDictionary } from "@/i18n/types";

type TabKey = "chats" | "connect" | "moments" | "my";

type ConnectProfile = {
  id: number;
  name: string;
  age: number;
  location: string;
  intro: string;
  tags: string[];
  about: string;
  interests: string[];
};

type MomentPost = {
  id: number;
  author: string;
  minutesAgo: number;
  type: "image" | "video" | "text";
  caption: string;
  likes: number;
  comments: number;
};

type ChatRoom = {
  id: number;
  name: string;
  avatar: string;
  time: string;
  lastMessage: string;
  unread?: number;
};

type JoinedInvite = {
  token: string;
  roomName: string;
  inviterName: string;
  joinedAt: string;
};

type AdminImpersonatedUser = {
  id: string;
  name: string;
  handle: string;
};

const tabIconMap: { key: TabKey; icon: typeof MessageCircle }[] = [
  { key: "chats", icon: MessageCircle },
  { key: "connect", icon: Users },
  { key: "moments", icon: ImageIcon },
  { key: "my", icon: User },
];

const chatRooms: ChatRoom[] = [
  {
    id: 1,
    name: "Sofia",
    avatar: "S",
    time: "2분 전",
    lastMessage: "다음 주 토요일에 한강 같이 갈래?",
    unread: 1,
  },
  {
    id: 2,
    name: "Aiko",
    avatar: "A",
    time: "12분 전",
    lastMessage: "오늘 북클럽 일정 공유할게!",
  },
  {
    id: 3,
    name: "Mina",
    avatar: "M",
    time: "1시간 전",
    lastMessage: "부산 오면 카페 추천해줄게",
  },
];

const conversationSeeds: Record<number, string[]> = {
  1: [
    "다음 주 토요일에 한강 같이 갈래?",
    "좋아요. 저녁에 재즈바도 가요.",
    "완전 좋아! 그날 영어/스페인어 섞어서 얘기해봐요.",
  ],
  2: [
    "오늘 북클럽 일정 공유할게!",
    "감사해요. 이번 책은 일본어 원서도 같이 볼까요?",
    "좋아요. 발음 어려운 부분 같이 연습해요.",
  ],
  3: [
    "부산 오면 카페 추천해줄게",
    "진짜요? 바다 보이는 곳이면 더 좋아요.",
    "그럼 광안리 근처부터 리스트 짜볼게요.",
  ],
};

const connectProfiles: ConnectProfile[] = [
  {
    id: 1,
    name: "Sofia",
    age: 27,
    location: "Seoul · Spain",
    intro: "한강 러닝 + 재즈바 + 새로운 언어 배우기",
    tags: ["Travel", "Jazz", "Language"],
    about:
      "서울에서 UX 디자이너로 일하고 있고 주말엔 러닝을 하거나 전시를 봐요. 진짜 대화를 즐기는 친구를 만나고 싶어요.",
    interests: ["한강 러닝", "사진 산책", "재즈 공연", "스페인어 교환"],
  },
  {
    id: 2,
    name: "Mina",
    age: 25,
    location: "Busan · Korea",
    intro: "다이빙, 필름카메라, 브런치 카페 투어",
    tags: ["Ocean", "Photo", "Brunch"],
    about:
      "부산에서 콘텐츠 마케터로 일하고 있어요. 바다 근처 조용한 카페에서 이야기 나누는 시간을 좋아해요.",
    interests: ["프리다이빙", "필름카메라", "전시 관람", "카페 탐방"],
  },
  {
    id: 3,
    name: "Aiko",
    age: 29,
    location: "Tokyo · Japan",
    intro: "독립영화, 북클럽, 도심 야경 산책",
    tags: ["Movie", "Books", "Night Walk"],
    about:
      "도쿄에서 프로덕트 매니저로 일해요. 서로의 문화와 일상을 진솔하게 공유할 수 있는 관계를 찾고 있어요.",
    interests: ["독립영화", "북클럽", "도시 산책", "로컬 푸드"],
  },
];

const moments: MomentPost[] = [
  {
    id: 1,
    author: "noah.m",
    minutesAgo: 8,
    type: "image",
    caption: "오늘 처음 만난 친구랑 서울숲 산책. 생각보다 대화가 깊어져서 놀랐어.",
    likes: 82,
    comments: 14,
  },
  {
    id: 2,
    author: "yuna.lee",
    minutesAgo: 23,
    type: "video",
    caption: "한강 버스킹 30초 하이라이트. 라이브에서 만난 사람들과 즉흥 합주!",
    likes: 121,
    comments: 26,
  },
  {
    id: 3,
    author: "mingle.diary",
    minutesAgo: 51,
    type: "text",
    caption:
      "오늘의 기록: 어색함을 넘어서려면 질문보다 리액션이 먼저다. 상대의 말을 끝까지 듣는 10분이 관계를 바꾼다.",
    likes: 56,
    comments: 9,
  },
];

const DEFAULT_IMPERSONATED_USER: AdminImpersonatedUser = {
  id: "mingle_user",
  name: "mingle_user",
  handle: "mingle_user",
};

function readImpersonatedUser(): AdminImpersonatedUser {
  if (typeof window === "undefined") {
    return DEFAULT_IMPERSONATED_USER;
  }

  const params = new URLSearchParams(window.location.search);
  const fromQuery = {
    id: params.get("admin_user_id")?.trim() ?? "",
    name: params.get("admin_user_name")?.trim() ?? "",
    handle: params.get("admin_user_handle")?.trim() ?? "",
  };

  const normalizedId = fromQuery.id || DEFAULT_IMPERSONATED_USER.id;
  const normalizedName = fromQuery.name || fromQuery.handle || DEFAULT_IMPERSONATED_USER.name;
  const normalizedHandle = fromQuery.handle || fromQuery.name || DEFAULT_IMPERSONATED_USER.handle;

  return {
    id: normalizedId,
    name: normalizedName,
    handle: normalizedHandle.toLowerCase().replace(/[^a-z0-9._]/g, "") || DEFAULT_IMPERSONATED_USER.handle,
  };
}

function TopBar({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-[3.45rem] items-center justify-between border-b border-black/8 bg-background px-[1rem]">
      <h1 className="text-[1rem] font-semibold text-foreground">{title}</h1>
      {right}
    </header>
  );
}

function HeaderIconButton({ children }: { children: ReactNode }) {
  return (
    <button
      className="flex h-[2rem] w-[2rem] items-center justify-center rounded-full text-foreground transition-colors active:bg-black/5"
      type="button"
    >
      {children}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: typeof MessageCircle;
}) {
  return (
    <button
      className="flex flex-1 flex-col items-center justify-center gap-[0.18rem] py-[0.45rem]"
      onClick={onClick}
      type="button"
    >
      <Icon className={`h-[1.22rem] w-[1.22rem] ${active ? "text-primary" : "text-muted-foreground"}`} />
      <span
        className={`text-[0.66rem] font-medium leading-none ${active ? "text-primary" : "text-muted-foreground"}`}
      >
        {label}
      </span>
    </button>
  );
}

function ChatsTab({
  dictionary,
  inviteRecords,
  joinedInvites,
  savedConversations,
  onGenerateInvite,
  onJoinInvite,
  onSaveConversation,
}: {
  dictionary: AppDictionary;
  inviteRecords: InviteRecord[];
  joinedInvites: JoinedInvite[];
  savedConversations: SavedConversation[];
  onGenerateInvite: (roomId: number) => void;
  onJoinInvite: (token: string) => { ok: boolean; message: string };
  onSaveConversation: (roomId: number) => void;
}) {
  const [inviteTokenDraft, setInviteTokenDraft] = useState<string>("");
  const [feedback, setFeedback] = useState<string>("");

  const latestInviteByRoom = useMemo(() => {
    const map = new Map<number, InviteRecord>();
    for (const invite of inviteRecords) {
      if (!map.has(Number(invite.conversationId.split("_")[1]))) {
        map.set(Number(invite.conversationId.split("_")[1]), invite);
      }
    }
    return map;
  }, [inviteRecords]);

  return (
    <>
      <TopBar
        title={dictionary.titles.chats}
        right={<HeaderIconButton><Plus className="h-[1.08rem] w-[1.08rem]" /></HeaderIconButton>}
      />

      <div className="px-[1rem] pb-[0.35rem] pt-[0.75rem]">
        <div className="relative mb-[0.5rem]">
          <Search className="pointer-events-none absolute left-[0.74rem] top-[0.64rem] h-[0.92rem] w-[0.92rem] text-muted-foreground" />
          <input
            className="h-[2.2rem] w-full rounded-[0.75rem] bg-[#f4f5f7] pl-[2.15rem] pr-[0.75rem] text-[0.79rem] outline-none placeholder:text-muted-foreground"
            placeholder={dictionary.chat.searchPlaceholder}
          />
        </div>
      </div>

      <div>
        {chatRooms.map((room) => {
          const latestInvite = latestInviteByRoom.get(room.id);

          return (
            <article key={room.id} className="border-b border-black/6 px-[1rem] py-[0.7rem]">
              <button
                className="mb-[0.52rem] flex w-full items-center gap-[0.72rem] text-left"
                type="button"
              >
                <div className="flex h-[2.72rem] w-[2.72rem] items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-[0.82rem] font-semibold text-white">
                  {room.avatar}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-[0.12rem] flex items-center justify-between">
                    <p className="truncate text-[0.82rem] font-semibold">{room.name}</p>
                    <span className="text-[0.65rem] text-muted-foreground">{room.time}</span>
                  </div>
                  <p className="truncate text-[0.74rem] text-muted-foreground">{room.lastMessage}</p>
                </div>
                {room.unread ? (
                  <span className="flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-primary px-[0.24rem] text-[0.63rem] font-semibold text-white">
                    {room.unread}
                  </span>
                ) : null}
              </button>

              <div className="flex gap-[0.4rem]">
                <button
                  className="rounded-[0.52rem] border border-black/10 bg-white px-[0.58rem] py-[0.32rem] text-[0.67rem] font-medium"
                  onClick={() => onSaveConversation(room.id)}
                  type="button"
                >
                  {dictionary.chat.saveConversation}
                </button>
                <button
                  className="rounded-[0.52rem] bg-primary px-[0.58rem] py-[0.32rem] text-[0.67rem] font-medium text-white"
                  onClick={() => onGenerateInvite(room.id)}
                  type="button"
                >
                  {dictionary.chat.generateInvite}
                </button>
              </div>

              {latestInvite ? (
                <div className="mt-[0.45rem] rounded-[0.58rem] bg-muted px-[0.52rem] py-[0.46rem]">
                  <p className="mb-[0.24rem] text-[0.62rem] text-muted-foreground">
                    {dictionary.chat.recentInvite}
                  </p>
                  <p className="truncate text-[0.66rem]">{latestInvite.inviteUrl}</p>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <section className="mx-[1rem] mt-[0.75rem] rounded-[0.75rem] border border-black/8 bg-white p-[0.72rem]">
        <h2 className="mb-[0.38rem] text-[0.76rem] font-semibold">{dictionary.chat.joinTitle}</h2>
        <form
          className="flex gap-[0.35rem]"
          onSubmit={(event) => {
            event.preventDefault();
            const token = inviteTokenDraft.trim();
            if (!token) {
              return;
            }

            const result = onJoinInvite(token);
            setFeedback(result.message);
            if (result.ok) {
              setInviteTokenDraft("");
            }
          }}
        >
          <input
            className="h-[2rem] flex-1 rounded-[0.55rem] border border-black/10 px-[0.58rem] text-[0.7rem] outline-none"
            onChange={(event) => setInviteTokenDraft(event.target.value)}
            placeholder={dictionary.chat.inviteTokenPlaceholder}
            value={inviteTokenDraft}
          />
          <button
            className="rounded-[0.55rem] bg-primary px-[0.65rem] text-[0.67rem] font-semibold text-white"
            type="submit"
          >
            {dictionary.chat.join}
          </button>
        </form>
        {feedback ? <p className="mt-[0.34rem] text-[0.64rem] text-muted-foreground">{feedback}</p> : null}
      </section>

      <section className="mx-[1rem] mt-[0.55rem] mb-[0.75rem] rounded-[0.75rem] border border-black/8 bg-white p-[0.72rem]">
        <h2 className="mb-[0.38rem] text-[0.76rem] font-semibold">{dictionary.chat.recordsTitle}</h2>
        {savedConversations.length === 0 ? (
          <p className="text-[0.68rem] text-muted-foreground">{dictionary.chat.noConversation}</p>
        ) : (
          <div className="space-y-[0.34rem]">
            {savedConversations.slice(0, 3).map((conversation) => (
              <article key={conversation.id} className="rounded-[0.55rem] bg-muted px-[0.52rem] py-[0.42rem]">
                <p className="text-[0.69rem] font-semibold">{conversation.roomName}</p>
                <p className="truncate text-[0.65rem] text-muted-foreground">{conversation.summary}</p>
              </article>
            ))}
          </div>
        )}

        {joinedInvites.length > 0 ? (
          <div className="mt-[0.56rem] space-y-[0.3rem]">
            {joinedInvites.slice(0, 3).map((joined) => (
              <p key={joined.token} className="text-[0.65rem] text-muted-foreground">
                {joined.roomName} {dictionary.chat.joinedSuffix} ({joined.inviterName})
              </p>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

function ConnectTab({ dictionary }: { dictionary: AppDictionary }) {
  const [index, setIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [startX, setStartX] = useState<number | null>(null);
  const profiles = useMemo(() => connectProfiles, []);
  const profile = profiles[index % profiles.length];

  const releaseCard = (x: number) => {
    if (Math.abs(x) > 60) {
      setIndex((prev) => prev + 1);
    }
    setDragX(0);
    setStartX(null);
  };

  return (
    <>
      <TopBar
        title={dictionary.titles.connect}
        right={<HeaderIconButton><Filter className="h-[1rem] w-[1rem]" /></HeaderIconButton>}
      />

      <div className="overflow-x-hidden px-[1rem] pb-[0.9rem] pt-[0.7rem]">
        <div
          className="h-[30rem] overflow-hidden rounded-[1rem] border border-black/10 bg-white"
          style={{
            transform: `translateX(${dragX}px) rotate(${dragX * 0.016}deg)`,
            transition: startX === null ? "transform 0.2s ease" : "none",
          }}
        >
          <div
            className="h-[11.1rem] bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500 px-[0.9rem] pb-[0.85rem] pt-[0.8rem] text-white"
            onPointerDown={(event) => setStartX(event.clientX)}
            onPointerMove={(event) => {
              if (startX === null) {
                return;
              }
              const delta = event.clientX - startX;
              setDragX(Math.max(-90, Math.min(90, delta)));
            }}
            onPointerUp={() => releaseCard(dragX)}
            onPointerCancel={() => releaseCard(dragX)}
            style={{ touchAction: "pan-y" }}
          >
            <div className="inline-flex rounded-full bg-white/20 px-[0.55rem] py-[0.2rem] text-[0.67rem]">
              {profile.location}
            </div>
            <h2 className="mt-[0.6rem] text-[1.34rem] font-bold">
              {profile.name}, {profile.age}
            </h2>
            <p className="mt-[0.28rem] text-[0.75rem] text-white/90">{profile.intro}</p>
            <div className="mt-[0.52rem] flex flex-wrap gap-[0.35rem]">
              {profile.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/35 bg-white/20 px-[0.52rem] py-[0.18rem] text-[0.63rem]"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="h-[18.9rem] overflow-y-auto px-[0.9rem] pb-[0.9rem] pt-[0.75rem]">
            <h3 className="mb-[0.3rem] text-[0.78rem] font-semibold">{dictionary.connect.aboutTitle}</h3>
            <p className="mb-[0.72rem] text-[0.73rem] leading-[1.45] text-muted-foreground">{profile.about}</p>

            <h3 className="mb-[0.35rem] text-[0.78rem] font-semibold">
              {dictionary.connect.interestsTitle}
            </h3>
            <div className="mb-[0.75rem] flex flex-wrap gap-[0.35rem]">
              {profile.interests.map((interest) => (
                <span
                  key={interest}
                  className="rounded-full bg-[#f4f5f7] px-[0.52rem] py-[0.18rem] text-[0.64rem]"
                >
                  {interest}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-[0.75rem] flex items-center justify-center gap-[1rem]">
          <button
            className="flex h-[2.72rem] w-[2.72rem] items-center justify-center rounded-full bg-[#f4f5f7]"
            onClick={() => setIndex((prev) => prev + 1)}
            type="button"
          >
            <X className="h-[1.1rem] w-[1.1rem] text-muted-foreground" />
          </button>
          <button
            className="flex h-[2.95rem] w-[2.95rem] items-center justify-center rounded-full bg-primary text-white"
            onClick={() => setIndex((prev) => prev + 1)}
            type="button"
          >
            <Heart className="h-[1.2rem] w-[1.2rem]" />
          </button>
        </div>
      </div>
    </>
  );
}

function MomentsTab({ dictionary }: { dictionary: AppDictionary }) {
  return (
    <>
      <TopBar
        title={dictionary.titles.moments}
        right={<HeaderIconButton><Plus className="h-[1.05rem] w-[1.05rem]" /></HeaderIconButton>}
      />

      <div>
        {moments.map((post) => (
          <article key={post.id} className="border-b border-black/7 pb-[0.82rem] pt-[0.7rem]">
            <div className="mb-[0.58rem] flex items-center justify-between px-[1rem]">
              <div className="flex items-center gap-[0.54rem]">
                <div className="h-[1.95rem] w-[1.95rem] rounded-full bg-gradient-to-br from-amber-400 to-orange-500 p-[0.08rem]">
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-white text-[0.7rem] font-semibold">
                    {post.author.slice(0, 1).toUpperCase()}
                  </div>
                </div>
                <div>
                  <p className="text-[0.77rem] font-semibold">{post.author}</p>
                  <p className="text-[0.65rem] text-muted-foreground">
                    {post.minutesAgo}
                    {dictionary.moments.minutesAgoSuffix}
                  </p>
                </div>
              </div>
              <button className="text-muted-foreground" type="button">
                <MoreHorizontal className="h-[1rem] w-[1rem]" />
              </button>
            </div>

            {post.type === "image" ? (
              <div className="mb-[0.58rem] h-[12.1rem] w-full bg-gradient-to-br from-amber-200 via-orange-200 to-rose-200" />
            ) : null}

            {post.type === "video" ? (
              <div className="mb-[0.58rem] flex h-[12.1rem] w-full items-center justify-center bg-gradient-to-br from-neutral-900 to-neutral-700 text-[0.79rem] font-semibold text-neutral-100">
                <Video className="mr-[0.32rem] h-[1rem] w-[1rem]" /> {dictionary.moments.videoLabel}
              </div>
            ) : null}

            <div className="px-[1rem]">
              <div className="mb-[0.42rem] flex items-center justify-between">
                <div className="flex items-center gap-[0.58rem] text-foreground">
                  <Heart className="h-[0.98rem] w-[0.98rem]" />
                  <MessageCircle className="h-[0.98rem] w-[0.98rem]" />
                  <Send className="h-[0.97rem] w-[0.97rem]" />
                </div>
              </div>
              <p className="text-[0.74rem] leading-[1.42] text-foreground">{post.caption}</p>
              <p className="mt-[0.35rem] text-[0.66rem] text-muted-foreground">
                {dictionary.moments.likesLabel} {post.likes} · {dictionary.moments.commentsLabel}{" "}
                {post.comments}
              </p>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function MyTab({
  dictionary,
  googleOAuthEnabled,
  locale,
  onPopulateSeedData,
  profileHandle,
}: {
  dictionary: AppDictionary;
  googleOAuthEnabled: boolean;
  locale: string;
  onPopulateSeedData: () => void;
  profileHandle: string;
}) {
  const runtime = useMemo(() => detectMobileRuntime(), []);
  const { data: session, status } = useSession();

  return (
    <>
      <TopBar
        title={dictionary.titles.my}
        right={<HeaderIconButton><MoreHorizontal className="h-[1rem] w-[1rem]" /></HeaderIconButton>}
      />

      <div className="px-[1rem] pb-[0.8rem] pt-[0.8rem]">
        <div className="mb-[0.75rem] flex items-center justify-between gap-[0.7rem]">
          <div className="h-[4.3rem] w-[4.3rem] rounded-full bg-gradient-to-br from-amber-400 to-orange-500 p-[0.1rem]">
            <div className="h-full w-full rounded-full bg-white" />
          </div>
          <div className="flex flex-1 justify-between text-center">
            <div>
              <p className="text-[0.82rem] font-semibold">24</p>
              <p className="text-[0.66rem] text-muted-foreground">{dictionary.profile.postsLabel}</p>
            </div>
            <div>
              <p className="text-[0.82rem] font-semibold">1,240</p>
              <p className="text-[0.66rem] text-muted-foreground">{dictionary.profile.followersLabel}</p>
            </div>
            <div>
              <p className="text-[0.82rem] font-semibold">318</p>
              <p className="text-[0.66rem] text-muted-foreground">{dictionary.profile.followingLabel}</p>
            </div>
          </div>
        </div>

        <h2 className="text-[0.83rem] font-semibold">@{profileHandle}</h2>
        <p className="mb-[0.68rem] mt-[0.12rem] text-[0.72rem] text-muted-foreground">{dictionary.profile.bio}</p>

        <div className="mb-[0.72rem] grid grid-cols-2 gap-[0.45rem]">
          <button
            className="rounded-[0.55rem] border border-black/10 bg-white py-[0.52rem] text-[0.71rem] font-semibold"
            type="button"
          >
            {dictionary.profile.editProfile}
          </button>
          <button
            className="rounded-[0.55rem] border border-black/10 bg-white py-[0.52rem] text-[0.71rem] font-semibold"
            type="button"
          >
            {dictionary.profile.shareProfile}
          </button>
        </div>

        <div className="mb-[0.65rem] flex items-center justify-center border-y border-black/7 py-[0.47rem] text-muted-foreground">
          <Grid3X3 className="h-[1rem] w-[1rem]" />
        </div>

        <section className="mb-[0.72rem] rounded-[0.7rem] border border-black/8 bg-white px-[0.62rem] py-[0.58rem]">
          <p className="mb-[0.36rem] text-[0.68rem] font-semibold">{dictionary.profile.authTitle}</p>

          {status === "authenticated" ? (
            <>
              <p className="text-[0.64rem] text-muted-foreground">
                {dictionary.profile.signedInAs}: {session.user?.name ?? "User"}
              </p>
              <div className="mt-[0.4rem] flex gap-[0.4rem]">
                <Link
                  className="rounded-[0.55rem] border border-black/10 bg-white px-[0.62rem] py-[0.36rem] text-[0.66rem] font-semibold"
                  href={`/${locale}/account`}
                >
                  {dictionary.profile.accountPage}
                </Link>
                <button
                  className="rounded-[0.55rem] bg-primary px-[0.62rem] py-[0.36rem] text-[0.66rem] font-semibold text-white"
                  onClick={() => signOut({ callbackUrl: `/${locale}` })}
                  type="button"
                >
                  {dictionary.profile.logout}
                </button>
              </div>
            </>
          ) : (
            <div className="flex gap-[0.4rem]">
              <button
                className={`rounded-[0.55rem] border border-black/10 px-[0.62rem] py-[0.36rem] text-[0.66rem] font-semibold ${
                  googleOAuthEnabled ? "bg-white" : "bg-muted text-muted-foreground"
                }`}
                disabled={!googleOAuthEnabled}
                onClick={() => {
                  if (!googleOAuthEnabled) {
                    return;
                  }
                  signIn("google", { callbackUrl: `/${locale}` });
                }}
                type="button"
              >
                {dictionary.profile.loginGoogle}
              </button>
              <button
                className="rounded-[0.55rem] bg-primary px-[0.62rem] py-[0.36rem] text-[0.66rem] font-semibold text-white"
                onClick={() =>
                  signIn("credentials", {
                    callbackUrl: `/${locale}`,
                    email: "demo@mingle.dev",
                    name: "Mingle Demo",
                  })
                }
                type="button"
              >
                {dictionary.profile.loginDemo}
              </button>
            </div>
          )}

          {!googleOAuthEnabled ? (
            <p className="mt-[0.3rem] text-[0.62rem] text-muted-foreground">
              {dictionary.profile.googleNotConfigured}
            </p>
          ) : null}
        </section>

        <Link
          className="mb-[0.72rem] inline-flex rounded-[0.55rem] border border-black/10 bg-white px-[0.62rem] py-[0.36rem] text-[0.66rem] font-semibold"
          href={`/${locale}/translator`}
        >
          {dictionary.profile.translatorPage}
        </Link>

        <button
          className="mb-[0.72rem] inline-flex rounded-[0.55rem] border border-black/10 bg-white px-[0.62rem] py-[0.36rem] text-[0.66rem] font-semibold"
          onClick={onPopulateSeedData}
          type="button"
        >
          {dictionary.profile.populateSeedData}
        </button>

        <section className="mb-[0.72rem] rounded-[0.7rem] border border-black/8 bg-white px-[0.62rem] py-[0.58rem]">
          <div className="mb-[0.34rem] flex items-center justify-between">
            <div className="flex items-center gap-[0.28rem] text-[0.68rem] font-semibold">
              <Smartphone className="h-[0.84rem] w-[0.84rem]" />
              {dictionary.profile.mobileRuntime}
            </div>
            <span className="rounded-full bg-muted px-[0.4rem] py-[0.12rem] text-[0.6rem] font-medium">
              {runtime.platform.toUpperCase()}
            </span>
          </div>
          <p className="text-[0.64rem] text-muted-foreground">
            {dictionary.profile.nativeBridge}:{" "}
            {runtime.nativeBridge ? dictionary.profile.connected : dictionary.profile.webMode}
          </p>
          <p className="text-[0.64rem] text-muted-foreground">
            {dictionary.profile.safeArea}:{" "}
            {runtime.safeAreaEnabled ? dictionary.profile.enabled : dictionary.profile.disabled}
          </p>
          <p className="text-[0.64rem] text-muted-foreground">
            {dictionary.profile.backgroundPush}:{" "}
            {runtime.backgroundAudioReady && runtime.pushReady
              ? dictionary.profile.ready
              : dictionary.profile.webLimited}
          </p>
        </section>

        <div className="grid grid-cols-3 gap-[0.08rem] bg-black/8">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="aspect-square bg-gradient-to-br from-amber-100 via-orange-100 to-rose-100" />
          ))}
        </div>
      </div>
    </>
  );
}

function buildSavedConversation(room: ChatRoom): SavedConversation {
  const script = conversationSeeds[room.id] ?? [room.lastMessage];
  const now = new Date();
  const messages = script.map((text, index) => {
    const role: "partner" | "me" = index % 2 === 0 ? "partner" : "me";
    return {
      id: `${room.id}-${index + 1}`,
      role,
      text,
      createdAt: new Date(now.getTime() - (script.length - index) * 60000).toISOString(),
    };
  });

  return {
    id: `conversation_${room.id}`,
    roomId: room.id,
    roomName: room.name,
    roomAvatar: room.avatar,
    summary: script[script.length - 1] ?? room.lastMessage,
    messages,
    savedAt: now.toISOString(),
  };
}

type MingleHomeProps = {
  locale: string;
  dictionary: AppDictionary;
  googleOAuthEnabled: boolean;
};

export default function MingleHome({
  locale,
  dictionary,
  googleOAuthEnabled,
}: MingleHomeProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("chats");
  const [impersonatedUser] = useState<AdminImpersonatedUser>(() => readImpersonatedUser());
  const storageNamespace = impersonatedUser.id;
  const [savedConversations, setSavedConversations] = useState<SavedConversation[]>(() =>
    typeof window === "undefined" ? [] : loadSavedConversations(storageNamespace),
  );
  const [inviteRecords, setInviteRecords] = useState<InviteRecord[]>(() =>
    typeof window === "undefined" ? [] : loadInviteRecords(storageNamespace),
  );
  const [joinedInvites, setJoinedInvites] = useState<JoinedInvite[]>([]);

  useEffect(() => {
    saveConversations(savedConversations, storageNamespace);
  }, [savedConversations, storageNamespace]);

  useEffect(() => {
    saveInviteRecords(inviteRecords, storageNamespace);
  }, [inviteRecords, storageNamespace]);

  const inviteLookup = useMemo(() => {
    const map = new Map<string, InviteRecord>();
    for (const invite of inviteRecords) {
      map.set(invite.token, invite);
    }
    return map;
  }, [inviteRecords]);

  const upsertSavedConversation = (roomId: number): SavedConversation | null => {
    const room = chatRooms.find((item) => item.id === roomId);
    if (!room) {
      return null;
    }

    const conversation = buildSavedConversation(room);
    setSavedConversations((previous) => [
      conversation,
      ...previous.filter((item) => item.id !== conversation.id),
    ]);
    return conversation;
  };

  const handleGenerateInvite = (roomId: number): void => {
    const conversation = upsertSavedConversation(roomId);
    if (!conversation) {
      return;
    }

    const token = createInviteToken();
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://app.mingle.local";
    const invite: InviteRecord = {
      token,
      conversationId: conversation.id,
      inviterName: impersonatedUser.handle,
      inviteUrl: `${origin}/${locale}/invite/${token}`,
      createdAt: new Date().toISOString(),
    };

    setInviteRecords((previous) => [invite, ...previous].slice(0, 60));
  };

  const handleJoinInvite = (token: string): { ok: boolean; message: string } => {
    const invite = inviteLookup.get(token);
    if (!invite) {
      return { ok: false, message: dictionary.chat.joinNotFound };
    }

    const conversation = savedConversations.find(
      (item) => item.id === invite.conversationId,
    );
    const roomName = conversation?.roomName ?? dictionary.chat.unknownConversation;

    setJoinedInvites((previous) => {
      const existing = previous.some((item) => item.token === token);
      if (existing) {
        return previous;
      }
      return [
        {
          token,
          roomName,
          inviterName: invite.inviterName,
          joinedAt: new Date().toISOString(),
        },
        ...previous,
      ];
    });

    return { ok: true, message: `${roomName} ${dictionary.chat.joinSuccessSuffix}` };
  };

  const handlePopulateSeedData = (): void => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://app.mingle.local";
    const seeded = getSeedDataset({
      locale,
      inviterHandle: impersonatedUser.handle,
      baseOrigin: origin,
    });

    setSavedConversations(seeded.conversations);
    setInviteRecords(seeded.invites);
    setJoinedInvites([]);
  };

  return (
    <div className="min-h-screen bg-[#eceff3]">
      <div className="mobile-safe-shell mx-auto flex h-screen max-w-[30rem] flex-col overflow-hidden bg-background shadow-[0_0_0_1px_rgba(15,23,42,0.04)]">
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {activeTab === "chats" ? (
            <ChatsTab
              dictionary={dictionary}
              inviteRecords={inviteRecords}
              joinedInvites={joinedInvites}
              onGenerateInvite={handleGenerateInvite}
              onJoinInvite={handleJoinInvite}
              onSaveConversation={(roomId) => {
                upsertSavedConversation(roomId);
              }}
              savedConversations={savedConversations}
            />
          ) : null}
          {activeTab === "connect" ? <ConnectTab dictionary={dictionary} /> : null}
          {activeTab === "moments" ? <MomentsTab dictionary={dictionary} /> : null}
          {activeTab === "my" ? (
            <MyTab
              dictionary={dictionary}
              googleOAuthEnabled={googleOAuthEnabled}
              locale={locale}
              onPopulateSeedData={handlePopulateSeedData}
              profileHandle={impersonatedUser.handle}
            />
          ) : null}
        </main>

        <nav className="sticky bottom-0 z-20 flex h-[3.65rem] border-t border-black/8 bg-background">
          {tabIconMap.map((tab) => (
            <TabButton
              key={tab.key}
              active={activeTab === tab.key}
              icon={tab.icon}
              label={dictionary.tabs[tab.key]}
              onClick={() => setActiveTab(tab.key)}
            />
          ))}
        </nav>
      </div>
    </div>
  );
}
