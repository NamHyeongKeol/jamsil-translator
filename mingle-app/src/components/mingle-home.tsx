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

export default function MingleHome(props: MingleHomeProps) {
  const { status } = useSession();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const pendingNativeProviderRef = useRef<NativeAuthProvider | null>(null);
  const nativeAuthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackUrl = useMemo(() => `/${props.locale}/translator`, [props.locale]);

  const clearNativeAuthTimeout = useCallback(() => {
    if (nativeAuthTimeoutRef.current) {
      clearTimeout(nativeAuthTimeoutRef.current);
      nativeAuthTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = props.locale;
    }
  }, [props.locale]);

  useEffect(() => {
    if (status !== "loading") {
      clearNativeAuthTimeout();
      setIsSigningIn(false);
      pendingNativeProviderRef.current = null;
    }
  }, [clearNativeAuthTimeout, status]);

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
      if (pendingProvider && detail.provider !== pendingProvider) {
        return;
      }

      if (detail.type === "error") {
        pendingNativeProviderRef.current = null;
        setIsSigningIn(false);
        const normalizedMessage = (detail.message || "").trim().toLowerCase();
        if (normalizedMessage === "native_auth_cancelled") {
          return;
        }
        window.alert(props.dictionary.profile.nativeSignInFailed);
        return;
      }

      pendingNativeProviderRef.current = null;
      const bridgeToken = (detail.bridgeToken || "").trim();
      if (!bridgeToken) {
        setIsSigningIn(false);
        window.alert(props.dictionary.profile.nativeSignInFailed);
        return;
      }

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
  }, [callbackUrl, clearNativeAuthTimeout, props.dictionary.profile.nativeSignInFailed]);

  const handleSocialSignIn = useCallback((provider: "apple" | "google") => {
    setIsSigningIn(true);
    const nativeBridgeEnabled = typeof window !== "undefined" && isNativeAuthBridgeEnabled();
    if (nativeBridgeEnabled) {
      try {
        const startUrl = new URL("/api/native-auth/start", window.location.origin);
        startUrl.searchParams.set("provider", provider);
        startUrl.searchParams.set("callbackUrl", callbackUrl);
        const command: NativeAuthStartCommand = {
          type: "native_auth_start",
          payload: {
            provider,
            callbackUrl,
            startUrl: startUrl.toString(),
          },
        };
        pendingNativeProviderRef.current = provider;
        clearNativeAuthTimeout();
        nativeAuthTimeoutRef.current = setTimeout(() => {
          if (pendingNativeProviderRef.current !== provider) return;
          pendingNativeProviderRef.current = null;
          setIsSigningIn(false);
          window.alert(props.dictionary.profile.nativeSignInFailed);
        }, NATIVE_AUTH_FLOW_TIMEOUT_MS);
        window.ReactNativeWebView?.postMessage(JSON.stringify(command));
        return;
      } catch {
        clearNativeAuthTimeout();
        pendingNativeProviderRef.current = null;
        setIsSigningIn(false);
        window.alert(props.dictionary.profile.nativeSignInFailed);
        return;
      }
    }

    void signIn(provider, { callbackUrl }).catch(() => {
      setIsSigningIn(false);
    });
  }, [callbackUrl, clearNativeAuthTimeout, props.dictionary.profile.nativeSignInFailed]);

  useEffect(() => {
    return () => {
      clearNativeAuthTimeout();
    };
  }, [clearNativeAuthTimeout]);

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
