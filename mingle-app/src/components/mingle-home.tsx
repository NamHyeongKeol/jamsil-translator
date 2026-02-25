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

function isNativeAuthBridgeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.ReactNativeWebView?.postMessage !== "function") return false;
  try {
    const params = new URLSearchParams(window.location.search || "");
    const value = (params.get("nativeAuth") || "").trim().toLowerCase();
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}

export default function MingleHome(props: MingleHomeProps) {
  const { status } = useSession();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const pendingNativeProviderRef = useRef<NativeAuthProvider | null>(null);
  const callbackUrl = useMemo(() => `/${props.locale}/translator`, [props.locale]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = props.locale;
    }
  }, [props.locale]);

  useEffect(() => {
    if (status !== "loading") {
      setIsSigningIn(false);
      pendingNativeProviderRef.current = null;
    }
  }, [status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isNativeAuthBridgeEnabled()) return;

    const handleNativeAuthEvent = (event: Event) => {
      const detail = (event as CustomEvent<NativeAuthBridgeEvent>).detail;
      if (!detail || typeof detail !== "object") return;

      if (detail.type === "status") {
        return;
      }

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

    window.addEventListener(NATIVE_AUTH_EVENT, handleNativeAuthEvent as EventListener);
    return () => {
      window.removeEventListener(NATIVE_AUTH_EVENT, handleNativeAuthEvent as EventListener);
    };
  }, [callbackUrl, props.dictionary.profile.nativeSignInFailed]);

  const handleSocialSignIn = useCallback((provider: "apple" | "google") => {
    setIsSigningIn(true);
    if (typeof window !== "undefined" && isNativeAuthBridgeEnabled()) {
      try {
        const startUrl = new URL("/api/auth/native/start", window.location.origin);
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
        window.ReactNativeWebView?.postMessage(JSON.stringify(command));
        return;
      } catch {
        pendingNativeProviderRef.current = null;
      }
    }

    void signIn(provider, { callbackUrl }).catch(() => {
      setIsSigningIn(false);
    });
  }, [callbackUrl]);

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
