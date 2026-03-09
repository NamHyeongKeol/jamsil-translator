"use client";

import type { AppDictionary } from "@/i18n/types";
import {
  forwardRef,
  type FormEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Search, MessageCirclePlus } from "lucide-react";
import BottomTabBar from "@/components/bottom-tab-bar";
import MingleWordmark from "@/components/mingle-wordmark";

const RECENT_SEARCHES_STORAGE_KEY = "mingle:conversation-searches";
const RECENT_SEARCHES_SYNC_EVENT = "mingle:conversation-searches-sync";
const MAX_RECENT_SEARCHES = 6;

// ── 국기 매핑 ────────────────────────────────────────────────────────────
const LOCALE_FLAG: Record<string, string> = {
  ko: "🇰🇷", ja: "🇯🇵", en: "🇺🇸", zh: "🇨🇳", "zh-TW": "🇹🇼",
  fr: "🇫🇷", de: "🇩🇪", es: "🇪🇸", pt: "🇧🇷", it: "🇮🇹",
  ru: "🇷🇺", ar: "🇸🇦", hi: "🇮🇳", th: "🇹🇭", vi: "🇻🇳",
};

// ── 더미 대화방 데이터 ────────────────────────────────────────────────────
interface ConversationItem {
  id: string;
  name: string;
  countryLocale: string;
  lastMessage: string;
  time: string;
  unread: number;
  avatarColor: string;
}

function buildDummyConversations(
  dictionary: AppDictionary,
): ConversationItem[] {
  return [
    {
      id: "1",
      name: "Yuki",
      countryLocale: "ja",
      lastMessage: dictionary.conversations.sampleMessages.yuki,
      time: "02:07",
      unread: 0,
      avatarColor: "#f9a8d4",
    },
    {
      id: "2",
      name: "Maria",
      countryLocale: "es",
      lastMessage: dictionary.conversations.sampleMessages.maria,
      time: dictionary.conversations.yesterdayLabel,
      unread: 2,
      avatarColor: "#a5b4fc",
    },
    {
      id: "3",
      name: "Wei",
      countryLocale: "zh",
      lastMessage: dictionary.conversations.sampleMessages.wei,
      time: dictionary.conversations.yesterdayLabel,
      unread: 1,
      avatarColor: "#6ee7b7",
    },
    {
      id: "4",
      name: "Emma",
      countryLocale: "en",
      lastMessage: dictionary.conversations.sampleMessages.emma,
      time: dictionary.conversations.yesterdayLabel,
      unread: 1,
      avatarColor: "#fcd34d",
    },
    {
      id: "5",
      name: "Linh",
      countryLocale: "vi",
      lastMessage: dictionary.conversations.sampleMessages.linh,
      time: dictionary.conversations.saturdayLabel,
      unread: 0,
      avatarColor: "#f87171",
    },
    {
      id: "6",
      name: "Paris",
      countryLocale: "fr",
      lastMessage: dictionary.conversations.sampleMessages.paris,
      time: dictionary.conversations.saturdayLabel,
      unread: 1,
      avatarColor: "#93c5fd",
    },
  ];
}

function normalizeSearchTerm(rawValue: string): string {
  return rawValue.trim().replace(/\s+/g, " ");
}

function readStoredRecentSearches(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((value): value is string => typeof value === "string")
      .map((value) => normalizeSearchTerm(value))
      .filter(Boolean)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

function writeStoredRecentSearches(nextRecentSearches: string[]): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      RECENT_SEARCHES_STORAGE_KEY,
      JSON.stringify(nextRecentSearches),
    );
    window.dispatchEvent(new Event(RECENT_SEARCHES_SYNC_EVENT));
  } catch {
    // Ignore storage write failures in restricted environments.
  }
}

function subscribeRecentSearches(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleChange = (event: Event) => {
    if (
      event instanceof StorageEvent
      && event.key
      && event.key !== RECENT_SEARCHES_STORAGE_KEY
    ) {
      return;
    }
    onStoreChange();
  };

  window.addEventListener("storage", handleChange);
  window.addEventListener(RECENT_SEARCHES_SYNC_EVENT, handleChange);

  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(RECENT_SEARCHES_SYNC_EVENT, handleChange);
  };
}

// ── 대화방 아이템 ─────────────────────────────────────────────────────────
function ConversationRow({
  item,
  onSelect,
}: {
  item: ConversationItem;
  onSelect?: (item: ConversationItem) => void;
}) {
  const flag = LOCALE_FLAG[item.countryLocale] ?? "🌐";

  return (
    <button
      type="button"
      onClick={() => onSelect?.(item)}
      className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50 active:bg-gray-100"
    >
      {/* 프로필 사진 + 국기 */}
      <div className="relative shrink-0">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold text-white"
          style={{ background: item.avatarColor }}
        >
          {item.name[0]}
        </div>
        {/* 국기 배지 */}
        <span className="absolute bottom-0 left-0 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-white text-[11px]">
          {flag}
        </span>
      </div>

      {/* 텍스트 영역 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] font-semibold text-slate-900 truncate">{item.name}</span>
          <span className="ml-2 shrink-0 text-[12px] text-gray-400">{item.time}</span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <p className="truncate text-[13px] text-gray-500">{item.lastMessage}</p>
          {item.unread > 0 && (
            <span className="ml-2 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#7c3aed] px-1.5 text-[11px] font-bold text-white">
              {item.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── 검색 오버레이 ─────────────────────────────────────────────────────────
type SearchOverlayHandle = {
  focusInput: () => void;
};

type SearchOverlayProps = {
  open: boolean;
  onClose: () => void;
  conversations: ConversationItem[];
  dictionary: AppDictionary;
};

const SearchOverlay = forwardRef<SearchOverlayHandle, SearchOverlayProps>(function SearchOverlay({
  open,
  onClose,
  conversations,
  dictionary,
}, ref) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const touchStartXRef = useRef<number | null>(null);
  const recentSearches = useSyncExternalStore(
    subscribeRecentSearches,
    readStoredRecentSearches,
    () => [],
  );

  const focusInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;

    input.focus({ preventScroll: true });
    const cursorPosition = input.value.length;
    try {
      input.setSelectionRange(cursorPosition, cursorPosition);
    } catch {
      // Ignore selection failures on unsupported inputs.
    }
  }, []);

  useImperativeHandle(ref, () => ({ focusInput }), [focusInput]);

  useEffect(() => {
    if (!open) return;

    focusInput();
    const animationFrameId = window.requestAnimationFrame(() => {
      focusInput();
    });
    const timeoutId = window.setTimeout(() => {
      focusInput();
    }, 220);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
    };
  }, [focusInput, open]);

  const persistRecentSearch = useCallback((rawValue: string) => {
    const normalized = normalizeSearchTerm(rawValue);
    if (!normalized) return;

    writeStoredRecentSearches([
      normalized,
      ...recentSearches.filter(
        (item) => item.toLocaleLowerCase() !== normalized.toLocaleLowerCase(),
      ),
    ].slice(0, MAX_RECENT_SEARCHES));
  }, [recentSearches]);

  const dismissSearch = useCallback(() => {
    persistRecentSearch(query);
    setQuery("");
    onClose();
  }, [onClose, persistRecentSearch, query]);

  const filtered = useMemo(() => {
    const normalizedQuery = normalizeSearchTerm(query).toLocaleLowerCase();
    if (!normalizedQuery) return [];

    return conversations.filter(
      (c) =>
        c.name.toLocaleLowerCase().includes(normalizedQuery) ||
        c.lastMessage.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [query, conversations]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    persistRecentSearch(query);
    focusInput();
  }, [focusInput, persistRecentSearch, query]);

  const handleRecentSearchSelect = useCallback((recentSearch: string) => {
    setQuery(recentSearch);
    persistRecentSearch(recentSearch);
    focusInput();
  }, [focusInput, persistRecentSearch]);

  const handleResultSelect = useCallback((item: ConversationItem) => {
    persistRecentSearch(query || item.name);
  }, [persistRecentSearch, query]);

  const handleClearRecentSearches = useCallback(() => {
    writeStoredRecentSearches([]);
    focusInput();
  }, [focusInput]);

  const hasQuery = normalizeSearchTerm(query).length > 0;

  return (
    <div
      className="absolute inset-0 z-40 flex flex-col bg-white transition-transform duration-300 ease-in-out"
      style={{
        transform: open ? "translateX(0)" : "translateX(100%)",
        pointerEvents: open ? "auto" : "none",
      }}
      aria-hidden={!open}
      onTouchStart={(event) => {
        touchStartXRef.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const startX = touchStartXRef.current;
        const endX = event.changedTouches[0]?.clientX ?? startX ?? 0;
        touchStartXRef.current = null;

        if (startX !== null && endX - startX > 60) {
          dismissSearch();
        }
      }}
    >
      {/* 검색 입력 */}
      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-4 pb-3"
        style={{ paddingTop: "env(safe-area-inset-top, 44px)", marginTop: "12px" }}
      >
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-gray-100 px-3 py-2">
          <Search size={16} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={dictionary.conversations.searchPlaceholder}
            className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-gray-400"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>
        <button
          type="button"
          onClick={dismissSearch}
          className="shrink-0 text-[15px] font-medium text-[#7c3aed]"
        >
          {dictionary.conversations.cancelAction}
        </button>
      </form>

      <div className="flex-1 overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        {hasQuery ? (
          filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-gray-400">
              <p className="text-[14px]">{dictionary.conversations.noSearchResults}</p>
            </div>
          ) : (
            <div className="pt-2">
              {filtered.map((item, idx) => (
                <div key={item.id}>
                  <ConversationRow item={item} onSelect={handleResultSelect} />
                  {idx < filtered.length - 1 && (
                    <div className="mx-4 h-px bg-gray-100" />
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          <section className="px-4 pb-4 pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[13px] font-semibold tracking-[0.08em] text-slate-500">
                {dictionary.conversations.recentSearchesTitle}
              </h2>
              {recentSearches.length > 0 ? (
                <button
                  type="button"
                  onClick={handleClearRecentSearches}
                  className="shrink-0 text-[13px] font-medium text-[#7c3aed]"
                >
                  {dictionary.conversations.clearRecentSearchesAction}
                </button>
              ) : null}
            </div>
            {recentSearches.length === 0 ? (
              <p className="px-1 py-3 text-[14px] text-gray-400">
                {dictionary.conversations.noRecentSearches}
              </p>
            ) : (
              <div className="space-y-1">
                {recentSearches.map((recentSearch) => (
                  <button
                    key={recentSearch}
                    type="button"
                    onClick={() => handleRecentSearchSelect(recentSearch)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-gray-50 active:bg-gray-100"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100">
                      <Search size={16} className="text-gray-400" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px] text-slate-800">
                      {recentSearch}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
});

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────
type ConversationListProps = {
  locale: string;
  dictionary: AppDictionary;
};

export default function ConversationList({
  locale,
  dictionary,
}: ConversationListProps) {
  const [showSearch, setShowSearch] = useState(false);
  const searchOverlayRef = useRef<SearchOverlayHandle>(null);
  const conversations = useMemo(
    () => buildDummyConversations(dictionary),
    [dictionary],
  );

  const handleOpenSearch = useCallback(() => {
    setShowSearch(true);
    window.requestAnimationFrame(() => {
      searchOverlayRef.current?.focusInput();
    });
    window.setTimeout(() => {
      searchOverlayRef.current?.focusInput();
    }, 180);
  }, []);

  return (
    <main className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-white text-slate-900">
      {/* ── 검색 오버레이 ── */}
      <SearchOverlay
        ref={searchOverlayRef}
        open={showSearch}
        onClose={() => setShowSearch(false)}
        conversations={conversations}
        dictionary={dictionary}
      />

      {/* ── 상단 헤더 ── */}
      <header
        className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4"
        style={{
          paddingTop: "env(safe-area-inset-top, 44px)",
          height: "calc(56px + env(safe-area-inset-top, 44px))",
        }}
      >
        {/* Mingle 워드마크 */}
        <MingleWordmark />

        {/* 우측 아이콘 */}
        <div className="flex items-center gap-1">
          {/* 검색 */}
          <button
            type="button"
            onClick={handleOpenSearch}
            className="flex h-10 w-10 items-center justify-center rounded-full transition active:bg-gray-100"
            aria-label={dictionary.conversations.searchButtonLabel}
          >
            <Search size={22} strokeWidth={2} />
          </button>
          {/* 대화 추가 */}
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full transition active:bg-gray-100"
            aria-label={dictionary.conversations.newConversationButtonLabel}
          >
            <MessageCirclePlus size={22} strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* ── 대화 목록 ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-gray-400">
            <span className="mb-3 text-5xl">💬</span>
            <p className="text-[15px] font-semibold text-slate-700">
              {dictionary.conversations.emptyTitle}
            </p>
            <p className="mt-1 text-[13px] text-gray-400">
              {dictionary.conversations.emptyDescription}
            </p>
          </div>
        ) : (
          <div>
            {conversations.map((item, idx) => (
              <div key={item.id}>
                <ConversationRow item={item} />
                {idx < conversations.length - 1 && (
                  <div className="mx-4 h-px bg-gray-100" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 하단 탭바 ── */}
      <BottomTabBar locale={locale} dictionary={dictionary} />
    </main>
  );
}
