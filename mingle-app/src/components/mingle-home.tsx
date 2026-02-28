"use client";

import dynamic from "next/dynamic";
import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import type { AppDictionary } from "@/i18n/types";

const LivePhoneDemo = dynamic(
  () => import("@/components/LivePhoneDemo/LivePhoneDemo"),
  {
    ssr: false,
  },
);

type MingleHomeProps = {
  dictionary: AppDictionary;
  appleOAuthEnabled: boolean;
  googleOAuthEnabled: boolean;
  locale: string;
};

const NATIVE_AUTH_EVENT = "mingle:native-auth";
const NATIVE_AUTH_FLOW_TIMEOUT_MS = 86_400_000; // 24시간 — OAuth는 사용자가 얼마든지 시간을 쓸 수 있어야 함
type NativeAuthProvider = "apple" | "google";
type NativeAuthStartCommand = {
  type: "native_auth_start";
  payload: {
    provider: NativeAuthProvider;
    callbackUrl: string;
    startUrl: string;
  };
};
type NativeAuthBridgeEvent =
  | {
      type: "status";
      provider: NativeAuthProvider;
      status: "opening";
    }
  | {
      type: "success";
      provider: NativeAuthProvider;
      callbackUrl: string;
      bridgeToken: string;
    }
  | {
      type: "error";
      provider: NativeAuthProvider;
      message: string;
    };
type NativeAuthAckCommand = {
  type: "native_auth_ack";
  payload: {
    provider: NativeAuthProvider;
    outcome: "success" | "error";
    bridgeToken?: string;
  };
};
type NativeAuthResetCommand = {
  type: "native_auth_reset";
};
type NativeAuthPendingResponse =
  | {
      status: "pending";
    }
  | {
      status: "success";
      provider: NativeAuthProvider;
      callbackUrl: string;
      bridgeToken: string;
    }
  | {
      status: "error";
      provider?: NativeAuthProvider;
      callbackUrl: string;
      message: string;
    };

type AuthPanelStep = "provider" | "terms";
type LegalSheetKind = "privacy" | "terms";
const LEGAL_SHEET_EXIT_MS = 240;

type MingleWindowWithNativeAuthCache = Window & {
  __MINGLE_LAST_NATIVE_AUTH_EVENT?: NativeAuthBridgeEvent;
};

function isNativeAuthBridgeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.ReactNativeWebView?.postMessage !== "function")
    return false;
  return true;
}

function getWindowWithNativeAuthCache(): MingleWindowWithNativeAuthCache | null {
  if (typeof window === "undefined") return null;
  return window as MingleWindowWithNativeAuthCache;
}

function postNativeAuthAck(detail: NativeAuthBridgeEvent): void {
  if (typeof window === "undefined") return;
  if (!isNativeAuthBridgeEnabled()) return;
  if (detail.type === "status") return;

  const command: NativeAuthAckCommand = {
    type: "native_auth_ack",
    payload: {
      provider: detail.provider,
      outcome: detail.type,
      bridgeToken: detail.type === "success" ? detail.bridgeToken : undefined,
    },
  };

  try {
    window.ReactNativeWebView?.postMessage(JSON.stringify(command));
  } catch {
    // no-op
  }
}

// polling 경로에서 provider/outcome만으로 RN에 ACK를 전송하는 헬퍼.
// polling 성공 시 postNativeAuthAck를 호출하지 않으면 RN의 pendingAuthEventRef가
// 유지되어 scheduleAuthDispatchRetry가 재로그인 타이밍에 stale 이벤트를 쏘는 버그 발생.
function postNativeAuthAckForPolling(
  provider: NativeAuthProvider,
  outcome: "success" | "error",
  bridgeToken?: string,
): void {
  if (typeof window === "undefined") return;
  if (!isNativeAuthBridgeEnabled()) return;

  const command: NativeAuthAckCommand = {
    type: "native_auth_ack",
    payload: { provider, outcome, bridgeToken },
  };

  try {
    window.ReactNativeWebView?.postMessage(JSON.stringify(command));
  } catch {
    // no-op
  }
}

function createNativeAuthRequestId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `rq_${crypto.randomUUID().replaceAll("-", "")}`;
  }
  const fallback = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
  return `rq_${fallback}`;
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden>
      <path
        fill="#FFFFFF"
        d="M16.52 12.6c.02 2.1 1.85 2.8 1.87 2.81-.02.05-.29 1-.96 1.98-.58.86-1.2 1.72-2.15 1.74-.92.02-1.22-.55-2.28-.55-1.07 0-1.4.53-2.26.57-.92.03-1.62-.93-2.2-1.78-1.2-1.73-2.1-4.9-.88-7.02.6-1.05 1.66-1.72 2.81-1.74.88-.02 1.71.6 2.28.6.57 0 1.62-.74 2.73-.63.47.02 1.8.19 2.65 1.43-.07.04-1.58.92-1.57 2.59Zm-2.16-5.04c.48-.58.8-1.39.71-2.2-.69.03-1.53.46-2.03 1.04-.44.5-.82 1.32-.72 2.1.77.06 1.56-.39 2.04-.94Z"
      />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
      <path
        fill="#EA4335"
        d="M12.25 10.2v4.18h5.83c-.26 1.34-1.67 3.94-5.83 3.94-3.5 0-6.35-2.9-6.35-6.47 0-3.58 2.85-6.48 6.35-6.48 2 0 3.34.85 4.1 1.58l2.79-2.7C17.36 2.58 15 1.5 12.25 1.5 6.72 1.5 2.25 6 2.25 11.55c0 5.54 4.47 10.05 10 10.05 5.77 0 9.6-4.04 9.6-9.73 0-.65-.08-1.13-.16-1.67h-9.44Z"
      />
      <path
        fill="#34A853"
        d="M3.4 6.88 6.66 9.3c.88-1.74 2.7-2.95 5.6-2.95 2 0 3.34.85 4.1 1.58l2.79-2.7C17.36 2.58 15 1.5 12.25 1.5c-3.85 0-7.2 2.2-8.85 5.38Z"
      />
      <path
        fill="#FBBC05"
        d="M2.25 11.55c0 1.73.44 3.36 1.22 4.78l3.54-2.74c-.2-.58-.31-1.2-.31-1.84 0-.66.11-1.29.31-1.88L3.47 7.1a9.93 9.93 0 0 0-1.22 4.45Z"
      />
      <path
        fill="#4285F4"
        d="M12.25 21.6c2.7 0 4.97-.9 6.63-2.44l-3.23-2.65c-.9.63-2.06 1.06-3.4 1.06-2.9 0-4.72-1.96-5.51-4.58L3.4 15.33C5.05 18.98 8.4 21.6 12.25 21.6Z"
      />
    </svg>
  );
}

export default function MingleHome(props: MingleHomeProps) {
  const { status } = useSession();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signingInProvider, setSigningInProvider] =
    useState<NativeAuthProvider | null>(null);
  const [authPanelStep, setAuthPanelStep] = useState<AuthPanelStep>("provider");
  const [selectedProvider, setSelectedProvider] =
    useState<NativeAuthProvider | null>(null);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [legalSheetKind, setLegalSheetKind] = useState<LegalSheetKind | null>(
    null,
  );
  const [isLegalSheetClosing, setIsLegalSheetClosing] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const pendingNativeProviderRef = useRef<NativeAuthProvider | null>(null);
  const lastHandledBridgeTokenRef = useRef("");
  const pendingNativeRequestIdRef = useRef<string | null>(null);
  const nativeAuthPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const legalSheetCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const nativeAuthPollInFlightRef = useRef(false);
  const nativeAuthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const callbackUrl = useMemo(
    () => `/${props.locale}/translator`,
    [props.locale],
  );
  const localeSegment = useMemo(
    () => encodeURIComponent(props.locale),
    [props.locale],
  );
  const privacyPolicyUrl = useMemo(
    () => `https://translator.minglelabs.xyz/${localeSegment}/privacy-policy`,
    [localeSegment],
  );
  const termsOfUseUrl = useMemo(
    () => `https://translator.minglelabs.xyz/${localeSegment}/terms-of-use`,
    [localeSegment],
  );
  const hasAgreedAllRequiredTerms = agreedPrivacy && agreedTerms;
  const legalSheetUrl = legalSheetKind === "privacy"
    ? privacyPolicyUrl
    : legalSheetKind === "terms"
      ? termsOfUseUrl
      : "";
  const legalSheetTitle = legalSheetKind === "privacy"
    ? "Privacy Policy"
    : legalSheetKind === "terms"
      ? "Terms of Use"
      : "";
  const clearLegalSheetCloseTimer = useCallback(() => {
    if (legalSheetCloseTimerRef.current) {
      clearTimeout(legalSheetCloseTimerRef.current);
      legalSheetCloseTimerRef.current = null;
    }
  }, []);

  const clearNativeAuthTimeout = useCallback(() => {
    if (nativeAuthTimeoutRef.current) {
      clearTimeout(nativeAuthTimeoutRef.current);
      nativeAuthTimeoutRef.current = null;
    }
  }, []);

  const clearNativeAuthPoller = useCallback(() => {
    if (nativeAuthPollTimerRef.current) {
      clearInterval(nativeAuthPollTimerRef.current);
      nativeAuthPollTimerRef.current = null;
    }
    nativeAuthPollInFlightRef.current = false;
  }, []);

  const pollNativeAuthResult = useCallback(
    async (requestId: string, provider: NativeAuthProvider) => {
      if (pendingNativeRequestIdRef.current !== requestId) return;

      const response = await fetch(
        `/api/native-auth/pending?requestId=${encodeURIComponent(requestId)}`,
        {
          cache: "no-store",
        },
      );
      if (!response.ok) return;

      const payload = (await response.json()) as NativeAuthPendingResponse;
      if (pendingNativeRequestIdRef.current !== requestId) return;
      if (payload.status === "pending") return;

      clearNativeAuthPoller();
      clearNativeAuthTimeout();
      pendingNativeRequestIdRef.current = null;
      pendingNativeProviderRef.current = null;

      if (payload.status === "error") {
        // polling 경로 에러: RN에 ACK 전송하여 pendingAuthEventRef 클리어.
        postNativeAuthAckForPolling(provider, "error");
        setIsSigningIn(false);
        setSigningInProvider(null);
        const normalizedMessage = (payload.message || "").trim().toLowerCase();
        if (normalizedMessage === "native_auth_cancelled") {
          return;
        }
        window.alert(props.dictionary.profile.nativeSignInFailed);
        return;
      }

      if (payload.provider !== provider) {
        return;
      }
      const bridgeToken = (payload.bridgeToken || "").trim();
      if (!bridgeToken) {
        setIsSigningIn(false);
        setSigningInProvider(null);
        window.alert(props.dictionary.profile.nativeSignInFailed);
        return;
      }
      if (bridgeToken === lastHandledBridgeTokenRef.current) {
        // 이미 bridge 경로에서 처리된 토큰 — 중복 signIn 방지.
        // ACK는 반드시 전송해야 RN의 pendingAuthEventRef가 클리어됨.
        postNativeAuthAckForPolling(provider, "success", bridgeToken);
        return;
      }
      lastHandledBridgeTokenRef.current = bridgeToken;
      // polling 경로 성공: RN에 ACK 전송.
      postNativeAuthAckForPolling(provider, "success", bridgeToken);

      const nextCallbackUrl = (payload.callbackUrl || "").trim() || callbackUrl;
      void signIn("native-bridge", {
        token: bridgeToken,
        callbackUrl: nextCallbackUrl,
      }).catch(() => {
        setIsSigningIn(false);
        setSigningInProvider(null);
        window.alert(props.dictionary.profile.nativeSignInFailed);
      });
    },
    [
      callbackUrl,
      clearNativeAuthPoller,
      clearNativeAuthTimeout,
      props.dictionary.profile.nativeSignInFailed,
    ],
  );

  const startNativeAuthPoller = useCallback(
    (requestId: string, provider: NativeAuthProvider) => {
      clearNativeAuthPoller();
      nativeAuthPollInFlightRef.current = false;

      const run = () => {
        if (pendingNativeRequestIdRef.current !== requestId) return;
        if (nativeAuthPollInFlightRef.current) return;
        nativeAuthPollInFlightRef.current = true;
        void pollNativeAuthResult(requestId, provider)
          .catch(() => {
            // no-op
          })
          .finally(() => {
            nativeAuthPollInFlightRef.current = false;
          });
      };

      run();
      nativeAuthPollTimerRef.current = setInterval(run, 1200);
    },
    [clearNativeAuthPoller, pollNativeAuthResult],
  );

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = props.locale;
    }
  }, [props.locale]);

  useEffect(() => {
    if (status !== "loading") {
      clearNativeAuthTimeout();
      clearNativeAuthPoller();
      setIsSigningIn(false);
      setSigningInProvider(null);
      setAuthPanelStep("provider");
      setSelectedProvider(null);
      setAgreedPrivacy(false);
      setAgreedTerms(false);
      setLegalSheetKind(null);
      pendingNativeRequestIdRef.current = null;
      pendingNativeProviderRef.current = null;
      // RN 레이어에 auth 상태 리셋 명령 전송.
      // 로그아웃/세션 만료 시 RN의 pendingAuthEventRef와 retry 타이머를
      // 클리어해서 이전 세션의 auth 이벤트가 재전송되지 않도록 함.
      if (isNativeAuthBridgeEnabled()) {
        try {
          const resetCommand: NativeAuthResetCommand = { type: "native_auth_reset" };
          window.ReactNativeWebView?.postMessage(JSON.stringify(resetCommand));
        } catch {
          // no-op
        }
      }
    }
  }, [clearNativeAuthPoller, clearNativeAuthTimeout, status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isNativeAuthBridgeEnabled()) return;

    const processNativeAuthDetail = (
      detail: NativeAuthBridgeEvent | null | undefined,
    ) => {
      if (!detail || typeof detail !== "object") return;
      const cachedWindow = getWindowWithNativeAuthCache();
      if (cachedWindow) {
        delete cachedWindow.__MINGLE_LAST_NATIVE_AUTH_EVENT;
      }

      if (detail.type === "status") {
        return;
      }

      clearNativeAuthTimeout();

      const pendingProvider = pendingNativeProviderRef.current;
      if (!pendingProvider) {
        // Ignore late/stale native auth events when no auth flow is in progress.
        // Still ack so the RN layer can stop retrying this payload.
        postNativeAuthAck(detail);
        return;
      }
      if (pendingProvider && detail.provider !== pendingProvider) {
        return;
      }
      postNativeAuthAck(detail);

      if (detail.type === "error") {
        clearNativeAuthPoller();
        pendingNativeRequestIdRef.current = null;
        pendingNativeProviderRef.current = null;
        setIsSigningIn(false);
        setSigningInProvider(null);
        const normalizedMessage = (detail.message || "").trim().toLowerCase();
        if (normalizedMessage === "native_auth_cancelled") {
          return;
        }
        window.alert(props.dictionary.profile.nativeSignInFailed);
        return;
      }

      clearNativeAuthPoller();
      pendingNativeRequestIdRef.current = null;
      pendingNativeProviderRef.current = null;
      const bridgeToken = (detail.bridgeToken || "").trim();
      if (!bridgeToken) {
        setIsSigningIn(false);
        setSigningInProvider(null);
        window.alert(props.dictionary.profile.nativeSignInFailed);
        return;
      }
      if (bridgeToken === lastHandledBridgeTokenRef.current) {
        // 이미 polling 경로에서 처리된 토큰 — ACK만 전송하고 중복 signIn 방지.
        postNativeAuthAck(detail);
        return;
      }
      lastHandledBridgeTokenRef.current = bridgeToken;

      const nextCallbackUrl = (detail.callbackUrl || "").trim() || callbackUrl;
      void signIn("native-bridge", {
        token: bridgeToken,
        callbackUrl: nextCallbackUrl,
      }).catch(() => {
        setIsSigningIn(false);
        setSigningInProvider(null);
        window.alert(props.dictionary.profile.nativeSignInFailed);
      });
    };

    const handleNativeAuthEvent = (event: Event) => {
      processNativeAuthDetail(
        (event as CustomEvent<NativeAuthBridgeEvent>).detail,
      );
    };

    window.addEventListener(
      NATIVE_AUTH_EVENT,
      handleNativeAuthEvent as EventListener,
    );
    const pendingDetail =
      getWindowWithNativeAuthCache()?.__MINGLE_LAST_NATIVE_AUTH_EVENT;
    if (pendingDetail) {
      processNativeAuthDetail(pendingDetail);
    }
    return () => {
      window.removeEventListener(
        NATIVE_AUTH_EVENT,
        handleNativeAuthEvent as EventListener,
      );
    };
  }, [
    callbackUrl,
    clearNativeAuthPoller,
    clearNativeAuthTimeout,
    props.dictionary.profile.nativeSignInFailed,
  ]);

  const handleSocialSignIn = useCallback(
    (provider: "apple" | "google") => {
      setIsSigningIn(true);
      setSigningInProvider(provider);
      const nativeBridgeEnabled =
        typeof window !== "undefined" && isNativeAuthBridgeEnabled();
      if (nativeBridgeEnabled) {
        try {
          const requestId = createNativeAuthRequestId();
          const completeUrl = new URL(
            "/api/native-auth/complete",
            window.location.origin,
          );
          completeUrl.searchParams.set("provider", provider);
          completeUrl.searchParams.set("callbackUrl", callbackUrl);
          completeUrl.searchParams.set("requestId", requestId);
          completeUrl.searchParams.set("ngrok-skip-browser-warning", "1");
          const startUrl = new URL(
            `/${props.locale}/auth/native`,
            window.location.origin,
          );
          startUrl.searchParams.set("provider", provider);
          startUrl.searchParams.set("callbackUrl", completeUrl.toString());
          startUrl.searchParams.set("requestId", requestId);
          startUrl.searchParams.set("ngrok-skip-browser-warning", "1");
          const command: NativeAuthStartCommand = {
            type: "native_auth_start",
            payload: {
              provider,
              callbackUrl,
              startUrl: startUrl.toString(),
            },
          };
          pendingNativeRequestIdRef.current = requestId;
          pendingNativeProviderRef.current = provider;
          clearNativeAuthTimeout();
          startNativeAuthPoller(requestId, provider);
          nativeAuthTimeoutRef.current = setTimeout(() => {
            if (pendingNativeProviderRef.current !== provider) return;
            clearNativeAuthPoller();
            pendingNativeRequestIdRef.current = null;
            pendingNativeProviderRef.current = null;
            setIsSigningIn(false);
            setSigningInProvider(null);
            window.alert(props.dictionary.profile.nativeSignInFailed);
          }, NATIVE_AUTH_FLOW_TIMEOUT_MS);
          window.ReactNativeWebView?.postMessage(JSON.stringify(command));
          return;
        } catch {
          clearNativeAuthPoller();
          clearNativeAuthTimeout();
          pendingNativeRequestIdRef.current = null;
          pendingNativeProviderRef.current = null;
          setIsSigningIn(false);
          setSigningInProvider(null);
          window.alert(props.dictionary.profile.nativeSignInFailed);
          return;
        }
      }

      void signIn(provider, { callbackUrl }).catch(() => {
        setIsSigningIn(false);
        setSigningInProvider(null);
      });
    },
    [
      callbackUrl,
      clearNativeAuthPoller,
      clearNativeAuthTimeout,
      props.dictionary.profile.nativeSignInFailed,
      props.locale,
      startNativeAuthPoller,
    ],
  );

  const handleProviderSelect = useCallback(
    (provider: NativeAuthProvider) => {
      if (isSigningIn) return;
      setSelectedProvider(provider);
      setAgreedPrivacy(false);
      setAgreedTerms(false);
      setAuthPanelStep("terms");
    },
    [isSigningIn],
  );

  const handleBackToProviderSelect = useCallback(() => {
    if (isSigningIn) return;
    setAuthPanelStep("provider");
    setSelectedProvider(null);
    setAgreedPrivacy(false);
    setAgreedTerms(false);
  }, [isSigningIn]);

  const handleAgreeAllRequiredTerms = useCallback(() => {
    const next = !hasAgreedAllRequiredTerms;
    setAgreedPrivacy(next);
    setAgreedTerms(next);
  }, [hasAgreedAllRequiredTerms]);

  const handleOpenLegalSheet = useCallback((kind: LegalSheetKind) => {
    clearLegalSheetCloseTimer();
    setIsLegalSheetClosing(false);
    setLegalSheetKind(kind);
  }, [clearLegalSheetCloseTimer]);

  const handleCloseLegalSheet = useCallback(() => {
    if (!legalSheetKind || isLegalSheetClosing) return;
    setIsLegalSheetClosing(true);
    clearLegalSheetCloseTimer();
    legalSheetCloseTimerRef.current = setTimeout(() => {
      setLegalSheetKind(null);
      setIsLegalSheetClosing(false);
      legalSheetCloseTimerRef.current = null;
    }, LEGAL_SHEET_EXIT_MS);
  }, [clearLegalSheetCloseTimer, isLegalSheetClosing, legalSheetKind]);

  const handleAgreeAndStart = useCallback(() => {
    if (!selectedProvider) return;
    if (!hasAgreedAllRequiredTerms) return;
    handleSocialSignIn(selectedProvider);
  }, [handleSocialSignIn, hasAgreedAllRequiredTerms, selectedProvider]);

  useEffect(() => {
    return () => {
      clearNativeAuthPoller();
      clearNativeAuthTimeout();
      clearLegalSheetCloseTimer();
      pendingNativeRequestIdRef.current = null;
    };
  }, [clearLegalSheetCloseTimer, clearNativeAuthPoller, clearNativeAuthTimeout]);

  const handleSignOut = useCallback(() => {
    if (isDeletingAccount) return;
    void signOut({ callbackUrl: `/${props.locale}` });
  }, [isDeletingAccount, props.locale]);

  const handleDeleteAccount = useCallback(async () => {
    if (isDeletingAccount) return;
    const confirmed = window.confirm(
      props.dictionary.profile.deleteAccountConfirm,
    );
    if (!confirmed) return;

    setIsDeletingAccount(true);
    try {
      const response = await fetch("/api/account/delete", {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("account_delete_failed");
      }
      await signOut({ callbackUrl: `/${props.locale}` });
    } catch {
      window.alert(props.dictionary.profile.deleteAccountFailed);
    } finally {
      setIsDeletingAccount(false);
    }
  }, [
    isDeletingAccount,
    props.dictionary.profile.deleteAccountConfirm,
    props.dictionary.profile.deleteAccountFailed,
    props.locale,
  ]);

  // loading 상태와 unauthenticated 상태를 하나의 레이아웃으로 통합
  // — 패널은 항상 렌더, 내부 콘텐츠만 전환 (툭 튀어나오는 pop-in 방지)
  if (status === "loading" || status !== "authenticated") {
    const isLoading = status === "loading";
    const disabled = isSigningIn || isLoading;

    return (
      // ① main bg = 다크 (#1C1C1E) → 가장자리 흰색 제거
      <main
        className="relative flex h-full min-h-0 w-full flex-col overflow-hidden"
        style={{ background: "linear-gradient(160deg, #FBBC32 0%, #F97316 100%)" }}
      >
        <style>{`@keyframes fade-in {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          @keyframes legal-overlay-in {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          @keyframes legal-overlay-out {
            from { opacity: 1; }
            to   { opacity: 0; }
          }
          @keyframes legal-sheet-in {
            from { transform: translateY(100%); }
            to   { transform: translateY(0); }
          }
          @keyframes legal-sheet-out {
            from { transform: translateY(0); }
            to   { transform: translateY(100%); }
          }`}</style>

        {/* 스크린리더 로딩 상태 공지 */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {isLoading || signingInProvider !== null
            ? props.dictionary.profile.loginLoading
            : ""}
        </div>

        {/* 상단 Mingle 텍스트 로고 영역 */}
        <div className="flex flex-1 items-center justify-center">
          <span className="text-[2.8rem] font-extrabold leading-[1.08] text-[#2D2A1E]">
            Mingle
          </span>
        </div>

        {/* ③ 하단 다크 패널 — 항상 렌더, 내용만 조건부 */}
        <section
          aria-busy={isLoading || disabled}
          className="rounded-t-[2rem] bg-[#1C1C1E] px-5 pb-[calc(1.05rem+env(safe-area-inset-bottom))] pt-4"
        >
          {isLoading ? (
            /* 로딩 중 — 스피너만 */
            <div className="flex items-center justify-center gap-3 py-3 text-sm text-white/60">
              <Loader2 size={18} className="animate-spin" aria-hidden />
              <span>{props.dictionary.profile.loginLoading}</span>
            </div>
          ) : (
            /* 버튼/약관 패널 슬라이드 영역 */
            <div
              className="overflow-hidden"
              style={{ animation: "fade-in 0.25s ease both" }}
            >
              <div
                className={`flex w-[200%] transition-transform duration-300 ease-out ${
                  authPanelStep === "terms" ? "-translate-x-1/2" : "translate-x-0"
                }`}
              >
                <div className="w-1/2 shrink-0">
                  <div className="space-y-3">
                    <button
                      type="button"
                      aria-label={
                        signingInProvider === "apple"
                          ? props.dictionary.profile.loginLoading
                          : props.dictionary.profile.loginApple
                      }
                      onClick={() => handleProviderSelect("apple")}
                      disabled={!props.appleOAuthEnabled || disabled}
                      className="relative inline-flex w-full items-center justify-center rounded-2xl bg-black py-[0.92rem] text-[0.95rem] font-semibold text-white transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="absolute left-5">
                        <AppleMark />
                      </span>
                      {props.dictionary.profile.loginApple}
                    </button>

                    <button
                      type="button"
                      aria-label={
                        signingInProvider === "google"
                          ? props.dictionary.profile.loginLoading
                          : props.dictionary.profile.loginGoogle
                      }
                      onClick={() => handleProviderSelect("google")}
                      disabled={!props.googleOAuthEnabled || disabled}
                      className="relative inline-flex w-full items-center justify-center rounded-2xl bg-white py-[0.92rem] text-[0.95rem] font-semibold text-slate-800 transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="absolute left-5">
                        <GoogleMark />
                      </span>
                      {props.dictionary.profile.loginGoogle}
                    </button>

                    {!props.appleOAuthEnabled ? (
                      <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
                        {props.dictionary.profile.appleNotConfigured}
                      </p>
                    ) : null}
                    {!props.googleOAuthEnabled ? (
                      <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
                        {props.dictionary.profile.googleNotConfigured}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="w-1/2 shrink-0 pl-4">
                  <div className="text-white">
                    <h2 className="text-[1.22rem] font-semibold leading-tight">
                      Service Terms
                    </h2>
                    <button
                      type="button"
                      onClick={handleAgreeAllRequiredTerms}
                      disabled={disabled}
                      className="mt-4 flex h-10 w-full items-center gap-2.5 rounded-xl bg-white/8 px-3.5 text-left text-[0.9rem] font-semibold leading-none text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span
                        className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[0.62rem] ${
                          hasAgreedAllRequiredTerms
                            ? "border-rose-400 bg-rose-500 text-white"
                            : "border-white/25 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span className="inline-flex h-full items-center leading-none">
                        Agree to all
                      </span>
                    </button>

                    <div className="mt-1.5 space-y-0.5">
                      <div className="flex items-center gap-2.5 px-1 py-1.5 text-[0.94rem] text-white/90">
                        <input
                          type="checkbox"
                          checked={agreedPrivacy}
                          onChange={(event) => setAgreedPrivacy(event.target.checked)}
                          disabled={disabled}
                          className="h-4 w-4 accent-rose-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleOpenLegalSheet("privacy")}
                          className="flex-1 text-left underline underline-offset-4"
                        >
                          Privacy Policy (Required)
                        </button>
                      </div>
                      <div className="flex items-center gap-2.5 px-1 py-1.5 text-[0.94rem] text-white/90">
                        <input
                          type="checkbox"
                          checked={agreedTerms}
                          onChange={(event) => setAgreedTerms(event.target.checked)}
                          disabled={disabled}
                          className="h-4 w-4 accent-rose-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleOpenLegalSheet("terms")}
                          className="flex-1 text-left underline underline-offset-4"
                        >
                          Terms of Use (Required)
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleAgreeAndStart}
                      disabled={!selectedProvider || !hasAgreedAllRequiredTerms || disabled}
                      className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-xl bg-white/20 px-3 text-[0.96rem] font-semibold leading-none text-white transition disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/45"
                    >
                      {isSigningIn ? (
                        <Loader2 size={18} className="animate-spin" aria-hidden />
                      ) : (
                        <span className="inline-flex h-full items-center leading-none">
                          Agree and continue
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleBackToProviderSelect}
                      disabled={disabled}
                      className="mt-3 inline-flex w-full items-center justify-center py-1 text-center text-[0.9rem] text-white/70 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Sign in with another method
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
        {legalSheetKind ? (
          <div
            className="absolute inset-0 z-40 flex items-end bg-black/55"
            style={{
              animation: isLegalSheetClosing
                ? "legal-overlay-out 0.22s ease both"
                : "legal-overlay-in 0.2s ease both",
            }}
            onClick={handleCloseLegalSheet}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-label={legalSheetTitle}
              onClick={(event) => event.stopPropagation()}
              className="flex h-[75vh] max-h-[75vh] w-full flex-col overflow-hidden rounded-t-[1.1rem] bg-[#111214] pb-[env(safe-area-inset-bottom)]"
              style={{
                animation: isLegalSheetClosing
                  ? "legal-sheet-out 0.24s cubic-bezier(0.4, 0, 0.2, 1) both"
                  : "legal-sheet-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
              }}
            >
              <div className="relative flex items-center justify-center border-b border-white/10 px-4 py-4">
                <button
                  type="button"
                  onClick={handleCloseLegalSheet}
                  aria-label="Close legal sheet"
                  className="absolute left-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/90 transition hover:bg-white/20"
                >
                  <X size={24} strokeWidth={2.35} />
                </button>
                <p className="text-[0.9rem] font-semibold text-white/90">
                  {legalSheetTitle}
                </p>
              </div>
              <iframe
                title={legalSheetTitle}
                src={legalSheetUrl}
                className="min-h-0 w-full flex-1 bg-white"
              />
            </section>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <main className="h-full min-h-0 w-full overflow-hidden bg-white text-slate-900">
      <LivePhoneDemo
        enableAutoTTS
        uiLocale={props.locale}
        tapPlayToStartLabel={props.dictionary.demo.tapPlayToStart}
        usageLimitReachedLabel={props.dictionary.demo.usageLimitReached}
        usageLimitRetryHintLabel={props.dictionary.demo.usageLimitRetryHint}
        connectingLabel={props.dictionary.demo.connecting}
        connectionFailedLabel={props.dictionary.demo.connectionFailed}
        muteTtsLabel={props.dictionary.demo.muteTts}
        unmuteTtsLabel={props.dictionary.demo.unmuteTts}
        menuLabel={props.dictionary.profile.menuLabel}
        logoutLabel={props.dictionary.profile.logout}
        deleteAccountLabel={props.dictionary.profile.deleteAccount}
        onLogout={handleSignOut}
        onDeleteAccount={handleDeleteAccount}
        isAuthActionPending={isDeletingAccount}
      />
    </main>
  );
}
