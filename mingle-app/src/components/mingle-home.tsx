"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
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
const NATIVE_AUTH_FLOW_TIMEOUT_MS = 45_000;
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
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="currentColor"
        d="M16.52 12.6c.02 2.1 1.85 2.8 1.87 2.81-.02.05-.29 1-.96 1.98-.58.86-1.2 1.72-2.15 1.74-.92.02-1.22-.55-2.28-.55-1.07 0-1.4.53-2.26.57-.92.03-1.62-.93-2.2-1.78-1.2-1.73-2.1-4.9-.88-7.02.6-1.05 1.66-1.72 2.81-1.74.88-.02 1.71.6 2.28.6.57 0 1.62-.74 2.73-.63.47.02 1.8.19 2.65 1.43-.07.04-1.58.92-1.57 2.59Zm-2.16-5.04c.48-.58.8-1.39.71-2.2-.69.03-1.53.46-2.03 1.04-.44.5-.82 1.32-.72 2.1.77.06 1.56-.39 2.04-.94Z"
      />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
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
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const pendingNativeProviderRef = useRef<NativeAuthProvider | null>(null);
  const lastHandledBridgeTokenRef = useRef("");
  const pendingNativeRequestIdRef = useRef<string | null>(null);
  const nativeAuthPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(
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
        return;
      }
      lastHandledBridgeTokenRef.current = bridgeToken;

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
      pendingNativeRequestIdRef.current = null;
      pendingNativeProviderRef.current = null;
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
          const startUrl = new URL(
            "/api/native-auth/start",
            window.location.origin,
          );
          startUrl.searchParams.set("provider", provider);
          startUrl.searchParams.set("callbackUrl", callbackUrl);
          startUrl.searchParams.set("requestId", requestId);
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
      startNativeAuthPoller,
    ],
  );

  useEffect(() => {
    return () => {
      clearNativeAuthPoller();
      clearNativeAuthTimeout();
      pendingNativeRequestIdRef.current = null;
    };
  }, [clearNativeAuthPoller, clearNativeAuthTimeout]);

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

  if (status === "loading") {
    return (
      <main className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-slate-950 px-6 text-slate-100">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-16 top-8 h-44 w-44 rounded-full bg-cyan-400/25 blur-3xl" />
          <div className="absolute -right-20 bottom-10 h-56 w-56 rounded-full bg-blue-500/20 blur-3xl" />
        </div>
        <div className="relative flex items-center gap-3 rounded-full border border-white/20 bg-white/10 px-5 py-2 text-sm text-slate-100 backdrop-blur-md">
          <Loader2 size={16} className="animate-spin text-cyan-200" />
          <span>{props.dictionary.profile.loginLoading}</span>
        </div>
      </main>
    );
  }

  if (status !== "authenticated") {
    const disabled = isSigningIn;
    return (
      <main className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-slate-950 px-6 text-slate-900">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-16 top-8 h-44 w-44 rounded-full bg-cyan-400/25 blur-3xl" />
          <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-400/20 blur-3xl" />
          <div className="absolute -right-20 bottom-10 h-56 w-56 rounded-full bg-blue-500/20 blur-3xl" />
        </div>
        <section
          aria-busy={disabled}
          style={{
            animation: "auth-card-in 0.35s cubic-bezier(0.22,1,0.36,1) both",
          }}
          className="relative w-full max-w-[23rem] rounded-[2rem] border border-white/60 bg-white/90 px-6 py-7 shadow-[0_30px_90px_-30px_rgba(15,23,42,0.7)] backdrop-blur-md sm:px-7"
        >
          <style>{`@keyframes auth-card-in {
              from { opacity: 0; transform: translateY(16px) scale(0.97); }
              to   { opacity: 1; transform: translateY(0)   scale(1); }
            }`}</style>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-[0.68rem] font-semibold tracking-[0.16em] text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            MINGLE
          </div>
          <p className="mb-2 text-xl font-semibold tracking-tight text-slate-900">
            {props.dictionary.profile.loginRequiredTitle}
          </p>
          <p className="mb-6 text-sm leading-relaxed text-slate-600">
            {props.dictionary.profile.loginRequiredDescription}
          </p>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => handleSocialSignIn("apple")}
              disabled={!props.appleOAuthEnabled || disabled}
              className="inline-flex w-full items-center justify-between rounded-2xl border border-black/5 bg-gradient-to-b from-slate-900 to-black px-4 py-3 text-sm font-medium text-white shadow-[0_10px_30px_-16px_rgba(15,23,42,0.9)] transition duration-200 hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
            >
              <span className="inline-flex items-center gap-2">
                <AppleMark />
                {props.dictionary.profile.loginApple}
              </span>
              {signingInProvider === "apple" ? (
                <Loader2 size={14} className="animate-spin text-white/70" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => handleSocialSignIn("google")}
              disabled={!props.googleOAuthEnabled || disabled}
              className="inline-flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.45)] transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_14px_30px_-18px_rgba(15,23,42,0.4)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
            >
              <span className="inline-flex items-center gap-2">
                <GoogleMark />
                {props.dictionary.profile.loginGoogle}
              </span>
              {signingInProvider === "google" ? (
                <Loader2 size={14} className="animate-spin text-slate-400" />
              ) : null}
            </button>
          </div>

          {!props.appleOAuthEnabled ? (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              {props.dictionary.profile.appleNotConfigured}
            </p>
          ) : null}
          {!props.googleOAuthEnabled ? (
            <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              {props.dictionary.profile.googleNotConfigured}
            </p>
          ) : null}
        </section>
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
