"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import type { AppDictionary } from "@/i18n/types";

const LivePhoneDemo = dynamic(() => import("@/components/LivePhoneDemo/LivePhoneDemo"), {
  ssr: false,
});

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
  if (typeof window.ReactNativeWebView?.postMessage !== "function") return false;
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
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `rq_${crypto.randomUUID().replaceAll("-", "")}`;
  }
  const fallback = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
  return `rq_${fallback}`;
}

export default function MingleHome(props: MingleHomeProps) {
  const { status } = useSession();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const pendingNativeProviderRef = useRef<NativeAuthProvider | null>(null);
  const lastHandledBridgeTokenRef = useRef("");
  const pendingNativeRequestIdRef = useRef<string | null>(null);
  const nativeAuthPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nativeAuthPollInFlightRef = useRef(false);
  const nativeAuthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackUrl = useMemo(() => `/${props.locale}/translator`, [props.locale]);

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

  const pollNativeAuthResult = useCallback(async (requestId: string, provider: NativeAuthProvider) => {
    if (pendingNativeRequestIdRef.current !== requestId) return;

    const response = await fetch(`/api/native-auth/pending?requestId=${encodeURIComponent(requestId)}`, {
      cache: "no-store",
    });
    if (!response.ok) return;

    const payload = await response.json() as NativeAuthPendingResponse;
    if (pendingNativeRequestIdRef.current !== requestId) return;
    if (payload.status === "pending") return;

    clearNativeAuthPoller();
    clearNativeAuthTimeout();
    pendingNativeRequestIdRef.current = null;
    pendingNativeProviderRef.current = null;

    if (payload.status === "error") {
      setIsSigningIn(false);
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
      window.alert(props.dictionary.profile.nativeSignInFailed);
    });
  }, [callbackUrl, clearNativeAuthPoller, clearNativeAuthTimeout, props.dictionary.profile.nativeSignInFailed]);

  const startNativeAuthPoller = useCallback((requestId: string, provider: NativeAuthProvider) => {
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
  }, [clearNativeAuthPoller, pollNativeAuthResult]);

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
      pendingNativeRequestIdRef.current = null;
      pendingNativeProviderRef.current = null;
    }
  }, [clearNativeAuthPoller, clearNativeAuthTimeout, status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isNativeAuthBridgeEnabled()) return;

    const processNativeAuthDetail = (detail: NativeAuthBridgeEvent | null | undefined) => {
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
        window.alert(props.dictionary.profile.nativeSignInFailed);
      });
    };

    const handleNativeAuthEvent = (event: Event) => {
      processNativeAuthDetail((event as CustomEvent<NativeAuthBridgeEvent>).detail);
    };

    window.addEventListener(NATIVE_AUTH_EVENT, handleNativeAuthEvent as EventListener);
    const pendingDetail = getWindowWithNativeAuthCache()?.__MINGLE_LAST_NATIVE_AUTH_EVENT;
    if (pendingDetail) {
      processNativeAuthDetail(pendingDetail);
    }
    return () => {
      window.removeEventListener(NATIVE_AUTH_EVENT, handleNativeAuthEvent as EventListener);
    };
  }, [callbackUrl, clearNativeAuthPoller, clearNativeAuthTimeout, props.dictionary.profile.nativeSignInFailed]);

  const handleSocialSignIn = useCallback((provider: "apple" | "google") => {
    setIsSigningIn(true);
    const nativeBridgeEnabled = typeof window !== "undefined" && isNativeAuthBridgeEnabled();
    if (nativeBridgeEnabled) {
      try {
        const requestId = createNativeAuthRequestId();
        const startUrl = new URL("/api/native-auth/start", window.location.origin);
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
        window.alert(props.dictionary.profile.nativeSignInFailed);
        return;
      }
    }

    void signIn(provider, { callbackUrl }).catch(() => {
      setIsSigningIn(false);
    });
  }, [callbackUrl, clearNativeAuthPoller, clearNativeAuthTimeout, props.dictionary.profile.nativeSignInFailed, startNativeAuthPoller]);

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
    const confirmed = window.confirm(props.dictionary.profile.deleteAccountConfirm);
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
  }, [isDeletingAccount, props.dictionary.profile.deleteAccountConfirm, props.dictionary.profile.deleteAccountFailed, props.locale]);

  if (status === "loading") {
    return (
      <main className="flex h-full min-h-0 w-full items-center justify-center bg-white px-6 text-slate-900">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          <span>{props.dictionary.profile.loginLoading}</span>
        </div>
      </main>
    );
  }

  if (status !== "authenticated") {
    const disabled = isSigningIn;
    return (
      <main className="flex h-full min-h-0 w-full items-center justify-center bg-white px-6 text-slate-900">
        <section className="w-full max-w-[20rem] rounded-2xl border border-slate-200 bg-slate-50 px-5 py-6">
          <p className="mb-1 text-lg font-semibold">{props.dictionary.profile.loginRequiredTitle}</p>
          <p className="mb-5 text-sm leading-relaxed text-slate-600">
            {props.dictionary.profile.loginRequiredDescription}
          </p>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => handleSocialSignIn("apple")}
              disabled={!props.appleOAuthEnabled || disabled}
              className="inline-flex w-full items-center justify-center rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
            >
              {props.dictionary.profile.loginApple}
            </button>
            <button
              type="button"
              onClick={() => handleSocialSignIn("google")}
              disabled={!props.googleOAuthEnabled || disabled}
              className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
            >
              {props.dictionary.profile.loginGoogle}
            </button>
          </div>

          {!props.appleOAuthEnabled ? (
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              {props.dictionary.profile.appleNotConfigured}
            </p>
          ) : null}
          {!props.googleOAuthEnabled ? (
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
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
