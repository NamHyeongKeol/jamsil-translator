"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

const FALLBACK_CALLBACK_URL = "/";
type OAuthProvider = "google" | "apple";

function resolveProvider(rawValue: string | null): OAuthProvider {
  const normalized = rawValue?.trim().toLowerCase();
  return normalized === "apple" ? "apple" : "google";
}

function resolveSafeCallbackUrl(rawValue: string | null): string {
  const trimmed = rawValue?.trim() ?? "";
  if (!trimmed) return FALLBACK_CALLBACK_URL;

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return FALLBACK_CALLBACK_URL;
    }
    return parsed.toString();
  } catch {
    return FALLBACK_CALLBACK_URL;
  }
}

export default function AuthSignInPage() {
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const provider = useMemo(() => resolveProvider(searchParams.get("provider")), [searchParams]);

  const callbackUrl = useMemo(
    () => resolveSafeCallbackUrl(searchParams.get("callbackUrl")),
    [searchParams],
  );

  const buttonLabel = provider === "apple" ? "Sign in with Apple" : "Sign in with Google";

  const handleProviderSignIn = useCallback(() => {
    setIsSubmitting(true);
    void signIn(provider, { callbackUrl }).catch(() => {
      setIsSubmitting(false);
    });
  }, [callbackUrl, provider]);

  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center bg-white px-6">
      <section className="w-full max-w-[22rem] rounded-3xl border border-slate-200 bg-slate-50 px-6 py-7">
        <button
          type="button"
          onClick={handleProviderSignIn}
          disabled={isSubmitting}
          className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-lg font-medium text-slate-900 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "Redirecting..." : buttonLabel}
        </button>
      </section>
    </main>
  );
}
