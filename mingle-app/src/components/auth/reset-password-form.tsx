"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AppDictionary } from "@/i18n/types";

type ResetPasswordFormProps = {
  dictionary: AppDictionary;
  locale: string;
  token: string;
};

function isValidPassword(password: string): boolean {
  return password.trim().length >= 8;
}

export default function ResetPasswordForm(props: ResetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [errorCode, setErrorCode] = useState<"required" | "password" | "mismatch" | "request" | null>(null);

  const errorMessage = errorCode === "required"
    ? props.dictionary.profile.emailRequiredFieldsMessage
    : errorCode === "password"
      ? props.dictionary.profile.emailAuthFailedMessage
      : errorCode === "mismatch"
        ? props.dictionary.profile.emailPasswordMismatchMessage
        : errorCode === "request"
          ? props.dictionary.profile.emailAuthNotReadyMessage
          : "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || isDone) return;

    const normalizedPassword = password.trim();
    const normalizedPasswordConfirm = passwordConfirm.trim();
    if (!normalizedPassword || !normalizedPasswordConfirm) {
      setErrorCode("required");
      return;
    }
    if (!isValidPassword(normalizedPassword)) {
      setErrorCode("password");
      return;
    }
    if (normalizedPassword !== normalizedPasswordConfirm) {
      setErrorCode("mismatch");
      return;
    }

    setErrorCode(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: props.token,
          password: normalizedPassword,
        }),
      });
      setIsSubmitting(false);
      if (!response.ok) {
        setErrorCode("request");
        return;
      }

      setIsDone(true);
    } catch {
      setIsSubmitting(false);
      setErrorCode("request");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
      <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h1 className="text-2xl font-bold text-slate-900">
          {props.dictionary.profile.emailResetPageTitle}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {props.dictionary.profile.emailResetPageSubtitle}
        </p>

        {isDone ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-emerald-700">
              {props.dictionary.profile.emailResetPasswordSuccess}
            </p>
            <Link
              href={`/${props.locale}`}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white"
            >
              {props.dictionary.profile.emailBackToLoginLink}
            </Link>
          </div>
        ) : (
          <form className="mt-6" onSubmit={handleSubmit}>
            <label className="text-xs font-semibold text-slate-800">
              {props.dictionary.profile.passwordFieldLabel}
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setErrorCode(null);
              }}
              disabled={isSubmitting}
              placeholder={props.dictionary.profile.passwordFieldPlaceholder}
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:border-slate-400"
            />

            <label className="mt-4 block text-xs font-semibold text-slate-800">
              {props.dictionary.profile.passwordConfirmFieldLabel}
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={passwordConfirm}
              onChange={(event) => {
                setPasswordConfirm(event.target.value);
                setErrorCode(null);
              }}
              disabled={isSubmitting}
              placeholder={props.dictionary.profile.passwordConfirmFieldPlaceholder}
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:border-slate-400"
            />

            {errorCode ? (
              <p className="mt-3 text-sm text-rose-600">{errorMessage}</p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isSubmitting ? (
                <Loader2 size={18} className="animate-spin" aria-hidden />
              ) : (
                props.dictionary.profile.emailResetPasswordAction
              )}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

