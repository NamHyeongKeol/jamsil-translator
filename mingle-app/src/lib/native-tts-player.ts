import { registerPlugin } from "@capacitor/core";
import { detectMobileRuntime } from "./mobile-runtime";

type NativeTtsPlayerPlugin = {
  play(options: { audioBase64: string; mimeType?: string; language?: string }): Promise<{ ok: boolean }>;
  stop(): Promise<void>;
};

const NativeTtsPlayer = registerPlugin<NativeTtsPlayerPlugin>("NativeTTSPlayer");

const LS_KEY_NATIVE_TTS_MODE = "mingle_native_tts_mode";
const ENV_NATIVE_TTS_MODE = (process.env.NEXT_PUBLIC_NATIVE_TTS_MODE || "auto").trim().toLowerCase();

function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Convert in chunks to avoid stack overflow on large payloads.
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function getNativeTtsMode(): "on" | "off" | "auto" {
  if (typeof window !== "undefined") {
    try {
      const override = window.localStorage.getItem(LS_KEY_NATIVE_TTS_MODE);
      if (override === "on" || override === "off") {
        return override;
      }
    } catch {
      // no-op
    }
  }
  if (ENV_NATIVE_TTS_MODE === "on" || ENV_NATIVE_TTS_MODE === "off") {
    return ENV_NATIVE_TTS_MODE;
  }
  return "auto";
}

export function shouldUseNativeTtsPlayback(): boolean {
  if (typeof window === "undefined") return false;
  const runtime = detectMobileRuntime();
  if (!runtime.nativeBridge || runtime.platform !== "ios") return false;
  const mode = getNativeTtsMode();
  if (mode === "off") return false;
  return true;
}

export async function playNativeTtsAudio(
  audioBlob: Blob,
  language?: string,
): Promise<void> {
  if (!shouldUseNativeTtsPlayback()) {
    throw new Error("native_tts_not_available");
  }
  const bytes = new Uint8Array(await audioBlob.arrayBuffer());
  const audioBase64 = uint8ArrayToBase64(bytes);
  await NativeTtsPlayer.play({
    audioBase64,
    mimeType: audioBlob.type || "audio/mpeg",
    language: language || "",
  });
}

export async function stopNativeTtsAudio(): Promise<void> {
  if (!shouldUseNativeTtsPlayback()) return;
  try {
    await NativeTtsPlayer.stop();
  } catch {
    // Best-effort stop only.
  }
}

