"use client";

import Link from "next/link";
import { useState } from "react";

type TranslateResponse = {
  sourceLanguage: string;
  targetLanguage: string;
  translatedText: string;
  provider: "mock" | "openai";
};

type TranslatorPageProps = {
  params: {
    locale: string;
  };
};

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto Detect" },
  { value: "ko", label: "Korean" },
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
  { value: "es", label: "Spanish" },
];

export default function TranslatorPage({ params }: TranslatorPageProps) {
  const locale = params.locale;
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const canSubmit = inputText.trim().length > 0 && !loading;

  async function submitTranslate() {
    if (!canSubmit) {
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: inputText,
          sourceLanguage,
          targetLanguage,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Translation failed");
      }

      const payload = (await response.json()) as TranslateResponse;
      setResult(payload);
    } catch (error) {
      setResult(null);
      setErrorMessage(error instanceof Error ? error.message : "Translation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-[42rem] bg-[#f8fafc] px-6 py-10 text-slate-900">
      <div className="mb-8 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Mingle Translator</h1>
        <Link
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
          href={`/${locale}`}
        >
          Back to app
        </Link>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Source</span>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              onChange={(event) => setSourceLanguage(event.target.value)}
              value={sourceLanguage}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Target</span>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              onChange={(event) => setTargetLanguage(event.target.value)}
              value={targetLanguage}
            >
              {LANGUAGE_OPTIONS.filter((option) => option.value !== "auto").map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mb-4 block text-sm text-slate-600">
          Input
          <textarea
            className="mt-1 min-h-[120px] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm"
            onChange={(event) => setInputText(event.target.value)}
            placeholder="Type sentence to translate..."
            value={inputText}
          />
        </label>

        <button
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={!canSubmit}
          onClick={submitTranslate}
          type="button"
        >
          {loading ? "Translating..." : "Translate"}
        </button>
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-lg font-semibold">Output</h2>
        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
        {!result && !errorMessage ? (
          <p className="text-sm text-slate-600">No translation yet.</p>
        ) : null}
        {result ? (
          <>
            <p className="mb-2 text-sm text-slate-500">
              detected: {result.sourceLanguage} / provider: {result.provider}
            </p>
            <p className="rounded-lg bg-slate-100 px-3 py-3 text-sm leading-relaxed">
              {result.translatedText}
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
