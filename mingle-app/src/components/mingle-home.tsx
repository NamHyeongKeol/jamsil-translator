"use client";

import LivePhoneDemo from "@/components/LivePhoneDemo/LivePhoneDemo";
import type { AppDictionary } from "@/i18n/types";

type MingleHomeProps = {
  dictionary: AppDictionary;
  googleOAuthEnabled: boolean;
  locale: string;
};

export default function MingleHome(props: MingleHomeProps) {
  void props;

  return (
    <main className="h-[100dvh] w-full bg-white text-slate-900">
      <LivePhoneDemo enableAutoTTS />
    </main>
  );
}
