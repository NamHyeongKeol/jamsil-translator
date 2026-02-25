"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

const FALLBACK_CALLBACK_URL = "/";

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

  const callbackUrl = useMemo(
    () => resolveSafeCallbackUrl(searchParams.get("callbackUrl")),
    [searchParams],
  );

  const handleGoogleSignIn = useCallback(() => {
    setIsSubmitting(true);
    void signIn("google", { callbackUrl }).catch(() => {
      setIsSubmitting(false);
    });
  }, [callbackUrl]);

  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center bg-white px-6">
      <section className="w-full max-w-[22rem] rounded-3xl border border-slate-200 bg-slate-50 px-6 py-7">
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isSubmitting}
          className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-lg font-medium text-slate-900 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "Redirecting..." : "Sign in with Google"}
        </button>
      </section>
    </main>
  );
}
