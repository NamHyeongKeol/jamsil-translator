import { registerPlugin } from "@capacitor/core";
import { detectMobileRuntime } from "./mobile-runtime";

type NativeSttStartOptions = {
  wsUrl: string;
  languages: string[];
  sttModel?: string;
  langHintsStrict?: boolean;
};

type NativeSttStopOptions = {
  pendingText?: string;
  pendingLanguage?: string;
};

type NativeSttPlugin = {
  start(options: NativeSttStartOptions): Promise<{ sampleRate: number }>;
  stop(options?: NativeSttStopOptions): Promise<void>;
  addListener(
    eventName: "status" | "message" | "error" | "close",
    listenerFunc: (event: Record<string, unknown>) => void,
  ): Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
};

const NativeSTT = registerPlugin<NativeSttPlugin>("NativeSTT");

const LS_KEY_NATIVE_STT_MODE = "mingle_native_stt_mode";
const ENV_NATIVE_STT_MODE = (process.env.NEXT_PUBLIC_NATIVE_STT_MODE || "auto").trim().toLowerCase();

function getNativeSttMode(): "on" | "off" | "auto" {
  if (typeof window !== "undefined") {
    try {
      const override = window.localStorage.getItem(LS_KEY_NATIVE_STT_MODE);
      if (override === "on" || override === "off") {
        return override;
      }
    } catch {
      // no-op
    }
  }
  if (ENV_NATIVE_STT_MODE === "on" || ENV_NATIVE_STT_MODE === "off") {
    return ENV_NATIVE_STT_MODE;
  }
  return "auto";
}

export function shouldUseNativeSttSession(): boolean {
  if (typeof window === "undefined") return false;
  const runtime = detectMobileRuntime();
  if (!runtime.nativeBridge || runtime.platform !== "ios") return false;
  const mode = getNativeSttMode();
  if (mode === "off") return false;
  return true;
}

export async function startNativeSttSession(options: NativeSttStartOptions): Promise<{ sampleRate: number }> {
  return NativeSTT.start(options);
}

export async function stopNativeSttSession(options?: NativeSttStopOptions): Promise<void> {
  try {
    await NativeSTT.stop(options);
  } catch {
    // Best-effort stop only.
  }
}

export async function addNativeSttListener(
  eventName: "status" | "message" | "error" | "close",
  listener: (event: Record<string, unknown>) => void,
): Promise<{ remove: () => Promise<void> }> {
  const handle = await NativeSTT.addListener(eventName, listener);
  return handle as { remove: () => Promise<void> };
}

