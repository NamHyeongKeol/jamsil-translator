"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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

export default function MingleHome(props: MingleHomeProps) {
  const { status } = useSession();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const callbackUrl = useMemo(() => `/${props.locale}/translator`, [props.locale]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = props.locale;
    }
  }, [props.locale]);

  useEffect(() => {
    if (status !== "loading") {
      setIsSigningIn(false);
    }
  }, [status]);

  const handleSocialSignIn = useCallback((provider: "apple" | "google") => {
    setIsSigningIn(true);
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
