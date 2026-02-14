import Link from "next/link";
import LivePhoneDemo from "@/components/LivePhoneDemo/LivePhoneDemo";

type TranslatorPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

export default async function TranslatorPage({ params }: TranslatorPageProps) {
  const { locale } = await params;

  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-orange-50 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
        <header className="rounded-3xl border border-amber-200/70 bg-white/90 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-500">Mingle Test Section</p>
              <h1 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">Realtime STT + Translation + Server TTS</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                녹음이 finalizing 되면 번역을 먼저 반영하고, 이어서 서버 경유 Inworld TTS를 재생하는 최신 테스트 빌드입니다.
              </p>
            </div>
            <Link
              href={`/${locale}`}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Back to app
            </Link>
          </div>
        </header>

        <section className="rounded-3xl border border-amber-100 bg-white/80 p-4 shadow-sm sm:p-8">
          <div className="mb-4 rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3 text-xs leading-relaxed text-amber-800">
            권장: iOS는 Safari 기준으로 확인해 주세요. iOS Chrome은 오디오 정책에 따라 동작 차이가 있을 수 있습니다.
          </div>
          <div className="flex justify-center">
            <LivePhoneDemo enableAutoTTS />
          </div>
        </section>
      </div>
    </main>
  );
}
