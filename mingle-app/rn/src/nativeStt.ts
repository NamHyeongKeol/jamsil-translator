import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

type NativeSttStartOptions = {
  wsUrl: string;
  languages: string[];
  sttModel?: string;
  langHintsStrict?: boolean;
  aecEnabled?: boolean;
};

type NativeSttStopOptions = {
  pendingText?: string;
  pendingLanguage?: string;
};

type NativeSttModuleType = {
  start(options: NativeSttStartOptions): Promise<{ sampleRate: number }>;
  stop(options?: NativeSttStopOptions): Promise<void>;
  setAec(enabled: boolean): Promise<{ ok: boolean }>;
};

type NativeSttEventMap = {
  status: { status: string };
  message: { raw: string };
  error: { message: string };
  close: { reason: string };
};

const nativeModule = NativeModules.NativeSTTModule as NativeSttModuleType | undefined;
const nativeEmitter = nativeModule ? new NativeEventEmitter(NativeModules.NativeSTTModule) : null;

export function isNativeSttAvailable(): boolean {
  return Platform.OS === 'ios' && Boolean(nativeModule && nativeEmitter);
}

export async function startNativeStt(options: NativeSttStartOptions): Promise<{ sampleRate: number }> {
  if (!nativeModule) {
    throw new Error('NativeSTTModule is unavailable on this runtime.');
  }
  return nativeModule.start(options);
}

export async function stopNativeStt(options?: NativeSttStopOptions): Promise<void> {
  if (!nativeModule) {
    return;
  }
  await nativeModule.stop(options || {});
}

export async function setNativeSttAec(enabled: boolean): Promise<void> {
  if (!nativeModule) {
    return;
  }
  await nativeModule.setAec(enabled);
}

export function addNativeSttListener<T extends keyof NativeSttEventMap>(
  eventName: T,
  listener: (event: NativeSttEventMap[T]) => void,
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
