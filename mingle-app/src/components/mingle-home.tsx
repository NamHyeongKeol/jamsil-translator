"use client";

import dynamic from "next/dynamic";
import type { AppDictionary } from "@/i18n/types";

const LivePhoneDemo = dynamic(() => import("@/components/LivePhoneDemo/LivePhoneDemo"), {
  ssr: false,
});

type MingleHomeProps = {
  dictionary: AppDictionary;
  googleOAuthEnabled: boolean;
  locale: string;
};

export default function MingleHome(props: MingleHomeProps) {
  void props;

  return (
    <main className="h-full min-h-0 w-full overflow-hidden bg-white text-slate-900">
      <LivePhoneDemo enableAutoTTS />
    </main>
  );
}
