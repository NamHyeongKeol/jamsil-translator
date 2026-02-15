import { registerPlugin } from "@capacitor/core";
import { detectMobileRuntime } from "./mobile-runtime";

type NativeAudioMode = "recording" | "playback";

type NativeAudioSessionPlugin = {
  setMode(options: { mode: NativeAudioMode }): Promise<{ mode: NativeAudioMode }>;
};

const NativeAudioSession = registerPlugin<NativeAudioSessionPlugin>("NativeAudioSession");

export async function setNativeAudioMode(mode: NativeAudioMode): Promise<void> {
  if (typeof window === "undefined") return;

  const runtime = detectMobileRuntime();
  if (!runtime.nativeBridge || runtime.platform !== "ios") return;

  try {
    await NativeAudioSession.setMode({ mode });
  } catch {
    // Best-effort on native. Web and unsupported shells should silently continue.
  }
}

