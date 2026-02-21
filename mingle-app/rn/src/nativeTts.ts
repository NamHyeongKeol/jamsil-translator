import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

type NativeTtsPlayOptions = {
  audioBase64: string;
  playbackId: string;
  utteranceId?: string;
};

type NativeTtsModuleType = {
  play(options: NativeTtsPlayOptions): Promise<{ ok: boolean }>;
  stop(): Promise<{ ok: boolean }>;
};

type NativeTtsEventMap = {
  ttsPlaybackFinished: {
    success: boolean;
    playbackId?: string;
    utteranceId?: string;
  };
  ttsPlaybackStopped: {
    playbackId?: string;
    utteranceId?: string;
  };
  ttsError: {
    message: string;
    playbackId?: string;
    utteranceId?: string;
  };
};

const nativeModule = NativeModules.NativeTTSModule as NativeTtsModuleType | undefined;
const nativeEmitter = nativeModule ? new NativeEventEmitter(NativeModules.NativeTTSModule) : null;

export function isNativeTtsAvailable(): boolean {
  return Platform.OS === 'ios' && Boolean(nativeModule && nativeEmitter);
}

export async function playNativeTts(options: NativeTtsPlayOptions): Promise<void> {
  if (!nativeModule) {
    throw new Error('NativeTTSModule is unavailable on this runtime.');
  }
  await nativeModule.play(options);
}

export async function stopNativeTts(): Promise<void> {
  if (!nativeModule) {
    return;
  }
  await nativeModule.stop();
}

export function addNativeTtsListener<T extends keyof NativeTtsEventMap>(
  eventName: T,
  listener: (event: NativeTtsEventMap[T]) => void,
): { remove: () => void } {
  if (!nativeEmitter) {
    return {
      remove: () => {
        // no-op on unsupported runtimes
      },
    };
  }

  const subscription = nativeEmitter.addListener(eventName, listener as (event: unknown) => void);
  return {
    remove: () => subscription.remove(),
  };
}
