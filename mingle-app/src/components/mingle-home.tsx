"use client";

import { Mic } from "lucide-react";
import { useRef } from "react";
import LivePhoneDemo, { type LivePhoneDemoRef } from "@/components/LivePhoneDemo/LivePhoneDemo";
import type { AppDictionary } from "@/i18n/types";

type MingleHomeProps = {
  dictionary: AppDictionary;
  googleOAuthEnabled: boolean;
  locale: string;
};

export default function MingleHome(props: MingleHomeProps) {
  const { locale } = props;
  const demoRef = useRef<LivePhoneDemoRef>(null);

  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-orange-50 px-4 py-5 text-slate-900">
      <div className="mx-auto flex w-full max-w-[460px] flex-col gap-4">
        <header className="rounded-3xl border border-amber-200/70 bg-white/90 px-5 py-4 shadow-sm backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-500">Mingle Test Section</p>
          <h1 className="mt-2 text-xl font-bold text-slate-900">Realtime STT + Translation + Server TTS</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            `mingle-landing`의 테스트 섹션 기능을 그대로 가져온 화면입니다. 현재 로케일: {locale.toUpperCase()}
          </p>
        </header>

        <section className="rounded-3xl border border-amber-100 bg-white/90 p-4 shadow-sm">
          <button
            type="button"
            onClick={() => demoRef.current?.startRecording()}
            className="mb-4 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2 text-sm font-semibold text-white transition-all active:scale-[0.98]"
          >
            <Mic className="h-4 w-4" />
            테스트 시작
          </button>

          <LivePhoneDemo ref={demoRef} enableAutoTTS />
        </section>
      </div>
    </main>
  );
}
