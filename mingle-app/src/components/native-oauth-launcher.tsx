"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDictionary, type AppLocale } from "@/i18n";

type NativeOAuthProvider = "apple" | "google";

type NativeOAuthLauncherProps = {
  locale: AppLocale;
  provider: NativeOAuthProvider;
  callbackUrl: string;
};

function resolveSafeCallbackUrl(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    if (!parsed.pathname.startsWith("/api/native-auth/complete")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export default function NativeOAuthLauncher({
  locale,
  provider,
  callbackUrl,
}: NativeOAuthLauncherProps) {
  const router = useRouter();
  const launchedRef = useRef(false);
  const [isLaunching, setIsLaunching] = useState(true);
  const text = getDictionary(locale).authLauncher;

  const beginSignIn = useCallback(async () => {
    const safeCallbackUrl = resolveSafeCallbackUrl(callbackUrl);
    if (!safeCallbackUrl) {
      router.replace(`/${locale}`);
      return;
    }
    await signIn(provider, { callbackUrl: safeCallbackUrl });
  }, [callbackUrl, locale, provider, router]);

  const handleRetry = useCallback(() => {
    setIsLaunching(true);
    void beginSignIn().catch(() => {
      setIsLaunching(false);
    });
  }, [beginSignIn]);

  useEffect(() => {
    if (launchedRef.current) return;
    launchedRef.current = true;
    void beginSignIn().catch(() => {
      setIsLaunching(false);
    });
  }, [beginSignIn]);

  return (
    // signIn 중에는 아무것도 렌더링하지 않음 — 즉시 Google/Apple 계정 선택 창으로 이동
    <main className="flex min-h-[100dvh] w-full items-center justify-center bg-white px-6">
      {!isLaunching && (
        <section className="w-full max-w-[22rem] rounded-2xl border border-slate-200 bg-slate-50 px-6 py-7 text-center">
          <h1 className="text-lg font-semibold text-slate-900">{text.title}</h1>
          <p className="mt-2 text-sm text-slate-600">{text.description}</p>
          <button
            type="button"
            onClick={handleRetry}
            disabled={isLaunching}
            className="mt-5 inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {text.retry}
          </button>
        </section>
      )}
    </main>
  );
}
