import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import {
  addNativeSttListener,
  isNativeSttAvailable,
  setNativeSttAec,
  startNativeStt,
  stopNativeStt,
} from './src/nativeStt';

import {
  addNativeTtsListener,
  playNativeTts,
  stopNativeTts,
} from './src/nativeTts';

type RuntimeEnvMap = Record<string, string | undefined>;

function readRuntimeEnvValue(keys: string[]): string {
  const env = (globalThis as { process?: { env?: RuntimeEnvMap } }).process?.env;
  if (!env) return '';

  for (const key of keys) {
    const value = env[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return '';
}

function resolveConfiguredUrl(
  keys: string[],
  allowedProtocols: string[],
  options?: { trimTrailingSlash?: boolean },
): string {
  const raw = readRuntimeEnvValue(keys);
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    if (!allowedProtocols.includes(parsed.protocol)) return '';
    if (options?.trimTrailingSlash) {
      return raw.replace(/\/+$/, '');
    }
    return raw;
  } catch {
    return '';
  }
}

function normalizeApiNamespace(raw: string): string {
  return raw.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

const RN_RUNTIME_OS = Platform.OS;
const EXPECTED_API_NAMESPACE_BY_OS: Record<'ios' | 'android', string> = {
  ios: 'mobile/ios/v1',
  android: 'mobile/android/v1',
};
const EXPECTED_API_NAMESPACE =
  RN_RUNTIME_OS === 'ios' || RN_RUNTIME_OS === 'android'
    ? EXPECTED_API_NAMESPACE_BY_OS[RN_RUNTIME_OS]
    : '';
const WEB_APP_BASE_URL = resolveConfiguredUrl(
  ['RN_WEB_APP_BASE_URL', 'NEXT_PUBLIC_SITE_URL'],
  ['http:', 'https:'],
  { trimTrailingSlash: true },
) || 'https://mingle-app-xi.vercel.app';
const DEFAULT_WS_URL = resolveConfiguredUrl(
  ['RN_DEFAULT_WS_URL', 'NEXT_PUBLIC_WS_URL'],
  ['ws:', 'wss:'],
) || 'wss://mingle.up.railway.app';
const CONFIGURED_API_NAMESPACE = normalizeApiNamespace(readRuntimeEnvValue(['RN_API_NAMESPACE']));
const VALIDATED_API_NAMESPACE =
  CONFIGURED_API_NAMESPACE &&
  EXPECTED_API_NAMESPACE &&
  CONFIGURED_API_NAMESPACE === EXPECTED_API_NAMESPACE
    ? CONFIGURED_API_NAMESPACE
    : '';

const missingRuntimeConfig: string[] = [];
if (!WEB_APP_BASE_URL) {
  missingRuntimeConfig.push('RN_WEB_APP_BASE_URL (or NEXT_PUBLIC_SITE_URL)');
}
if (!DEFAULT_WS_URL) {
  missingRuntimeConfig.push('RN_DEFAULT_WS_URL (or NEXT_PUBLIC_WS_URL)');
}
if (!EXPECTED_API_NAMESPACE) {
  missingRuntimeConfig.push(`Unsupported platform for RN_API_NAMESPACE validation: ${RN_RUNTIME_OS}`);
} else if (!CONFIGURED_API_NAMESPACE) {
  missingRuntimeConfig.push(`RN_API_NAMESPACE (expected: ${EXPECTED_API_NAMESPACE})`);
} else if (!VALIDATED_API_NAMESPACE) {
  missingRuntimeConfig.push(`RN_API_NAMESPACE must match current platform namespace: ${EXPECTED_API_NAMESPACE}`);
}
const REQUIRED_CONFIG_ERROR = missingRuntimeConfig.length > 0
  ? `Missing or invalid env: ${missingRuntimeConfig.join(', ')}`
  : null;

const NATIVE_STT_EVENT = 'mingle:native-stt';
const NATIVE_TTS_EVENT = 'mingle:native-tts';
const SUPPORTED_LOCALES = new Set(['ko', 'en', 'ja']);

type NativeSttStartPayload = {
  wsUrl?: string;
  languages?: string[];
  sttModel?: string;
  langHintsStrict?: boolean;
  aecEnabled?: boolean;
};

type NativeSttStopPayload = {
  pendingText?: string;
  pendingLanguage?: string;
};

type NativeSttCommand =
  | {
      type: 'native_stt_start';
      payload?: NativeSttStartPayload;
    }
  | {
      type: 'native_stt_stop';
      payload?: NativeSttStopPayload;
    };

type NativeTtsCommand =
  | {
      type: 'native_tts_play';
      payload: {
        utteranceId: string;
        playbackId?: string;
        audioBase64: string;
        contentType?: string;
      };
    }
  | {
      type: 'native_tts_stop';
      payload?: {
        reason?: string;
      };
    };

type NativeSttAecCommand = {
  type: 'native_stt_set_aec';
  payload: { enabled: boolean };
};

type WebViewCommand = NativeSttCommand | NativeTtsCommand | NativeSttAecCommand;

type NativeSttEvent =
  | { type: 'status'; status: string }
  | { type: 'message'; raw: string }
  | { type: 'error'; message: string }
  | { type: 'close'; reason: string };

function resolveLocaleSegment(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'ko';
    const code = locale.split('-')[0]?.toLowerCase() || 'ko';
    return SUPPORTED_LOCALES.has(code) ? code : 'ko';
  } catch {
    return 'ko';
  }
}

function App(): React.JSX.Element {
  const webViewRef = useRef<WebView>(null);
  const isPageReadyRef = useRef(false);
  const nativeAvailable = useMemo(() => isNativeSttAvailable(), []);
  const [loadError, setLoadError] = useState<string | null>(REQUIRED_CONFIG_ERROR);
  const nativeStatusRef = useRef('idle');
  const currentTtsPlaybackRef = useRef<{ utteranceId: string; playbackId: string } | null>(null);

  const locale = useMemo(() => resolveLocaleSegment(), []);
  const webUrl = useMemo(() => {
    if (!WEB_APP_BASE_URL || !VALIDATED_API_NAMESPACE || REQUIRED_CONFIG_ERROR) return '';
    const apiNamespaceQuery = `&apiNamespace=${encodeURIComponent(VALIDATED_API_NAMESPACE)}`;
    const debugParams = __DEV__ ? '&sttDebug=1&ttsDebug=1' : '';
    return `${WEB_APP_BASE_URL}/${locale}?nativeStt=1${apiNamespaceQuery}${debugParams}`;
  }, [locale]);

  const emitToWeb = useCallback((payload: NativeSttEvent) => {
    if (!isPageReadyRef.current) return;
    const serialized = JSON.stringify(payload);
    if (__DEV__) {
      const preview = payload.type === 'message'
        ? `message(${(payload as { raw?: string }).raw?.slice(0, 80) ?? ''})`
        : `${payload.type}(${JSON.stringify(payload).slice(0, 80)})`;
      console.log(`[NativeSTT→Web] ${preview}`);
    }
    const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(NATIVE_STT_EVENT)}, { detail: ${serialized} })); true;`;
    webViewRef.current?.injectJavaScript(script);
  }, []);

  const emitTtsToWeb = useCallback((payload: Record<string, unknown>) => {
    if (!isPageReadyRef.current) return;
    const serialized = JSON.stringify(payload);
    if (__DEV__) {
      console.log(`[NativeTTS→Web] ${JSON.stringify(payload).slice(0, 120)}`);
    }
    const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(NATIVE_TTS_EVENT)}, { detail: ${serialized} })); true;`;
    webViewRef.current?.injectJavaScript(script);
  }, []);

  const resolveCurrentTtsIdentity = useCallback((event?: { utteranceId?: string; playbackId?: string }) => {
    const active = currentTtsPlaybackRef.current;
    const eventPlaybackId = typeof event?.playbackId === 'string' ? event.playbackId : '';
    const eventUtteranceId = typeof event?.utteranceId === 'string' ? event.utteranceId : '';
    const playbackId = eventPlaybackId || active?.playbackId || '';
    const utteranceId = eventUtteranceId || active?.utteranceId || '';

    if (active) {
      if (playbackId && playbackId === active.playbackId) {
        currentTtsPlaybackRef.current = null;
      } else if (!playbackId && utteranceId && utteranceId === active.utteranceId) {
        currentTtsPlaybackRef.current = null;
      } else if (!playbackId && !utteranceId) {
        currentTtsPlaybackRef.current = null;
      }
    }

    return { utteranceId, playbackId };
  }, []);

  const handleNativeStart = useCallback(async (payload?: NativeSttStartPayload) => {
    if (!nativeAvailable) {
      emitToWeb({ type: 'error', message: 'native_stt_unavailable' });
      return;
    }

    const payloadWsUrl = typeof payload?.wsUrl === 'string' ? payload.wsUrl.trim() : '';
    if (!payloadWsUrl && !DEFAULT_WS_URL) {
      emitToWeb({ type: 'error', message: 'missing_ws_url_env(RN_DEFAULT_WS_URL or NEXT_PUBLIC_WS_URL)' });
      return;
    }

    const wsUrl = payloadWsUrl
      ? payloadWsUrl
      : DEFAULT_WS_URL;
    const languages = Array.isArray(payload?.languages)
      ? payload.languages.filter((language): language is string => typeof language === 'string' && language.trim().length > 0)
      : ['ko', 'en', 'th'];
    const sttModel = typeof payload?.sttModel === 'string' && payload.sttModel.trim()
      ? payload.sttModel.trim()
      : 'soniox';
    const langHintsStrict = payload?.langHintsStrict !== false;
    const aecEnabled = payload?.aecEnabled === true;

    try {
      nativeStatusRef.current = 'starting';
      await startNativeStt({
        wsUrl,
        languages,
        sttModel,
        langHintsStrict,
        aecEnabled,
      });
      nativeStatusRef.current = 'running';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      nativeStatusRef.current = 'failed';
      emitToWeb({ type: 'error', message });
    }
  }, [emitToWeb, nativeAvailable]);

  const handleNativeStop = useCallback(async (payload?: NativeSttStopPayload) => {
    try {
      await stopNativeStt({
        pendingText: typeof payload?.pendingText === 'string' ? payload.pendingText : '',
        pendingLanguage: typeof payload?.pendingLanguage === 'string' ? payload.pendingLanguage : 'unknown',
      });
      nativeStatusRef.current = 'stopped';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      emitToWeb({ type: 'error', message });
    }
  }, [emitToWeb]);

  const handleWebMessage = useCallback((event: WebViewMessageEvent) => {
    let parsed: WebViewCommand | null = null;
    try {
      parsed = JSON.parse(event.nativeEvent.data) as WebViewCommand;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;

    if (parsed.type === 'native_stt_start') {
      if (__DEV__) {
        console.log(`[Web→NativeSTT] ${parsed.type}`, JSON.stringify(parsed.payload ?? {}).slice(0, 120));
      }
      void handleNativeStart(parsed.payload);
      return;
    }

    if (parsed.type === 'native_stt_stop') {
      if (__DEV__) {
        console.log(`[Web→NativeSTT] ${parsed.type}`, JSON.stringify(parsed.payload ?? {}).slice(0, 120));
      }
      void handleNativeStop(parsed.payload);
      return;
    }

    if (parsed.type === 'native_tts_play') {
      const { utteranceId, audioBase64 } = parsed.payload;
      const playbackId = typeof parsed.payload.playbackId === 'string' && parsed.payload.playbackId.trim()
        ? parsed.payload.playbackId.trim()
        : utteranceId;
      currentTtsPlaybackRef.current = { utteranceId, playbackId };
      if (__DEV__) {
        console.log(`[Web→NativeTTS] play utteranceId=${utteranceId} playbackId=${playbackId} base64Len=${audioBase64.length}`);
      }
      void playNativeTts({ audioBase64, utteranceId, playbackId }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (__DEV__) {
          console.log(`[NativeTTS] play error playbackId=${playbackId}: ${message}`);
        }
        if (currentTtsPlaybackRef.current?.playbackId === playbackId) {
          currentTtsPlaybackRef.current = null;
        }
        emitTtsToWeb({ type: 'tts_error', utteranceId, playbackId, message });
      });
      return;
    }

    if (parsed.type === 'native_stt_set_aec') {
      const enabled = parsed.payload?.enabled === true;
      if (__DEV__) {
        console.log(`[Web→NativeSTT] setAec enabled=${enabled}`);
      }
      void setNativeSttAec(enabled);
      return;
    }

    if (parsed.type === 'native_tts_stop') {
      const reason = typeof parsed.payload?.reason === 'string' && parsed.payload.reason.trim()
        ? parsed.payload.reason.trim()
        : 'unspecified';
      if (__DEV__) {
        console.log(`[Web→NativeTTS] stop reason=${reason}`);
      }
      currentTtsPlaybackRef.current = null;
      void stopNativeTts();
    }
  }, [emitTtsToWeb, handleNativeStart, handleNativeStop]);

  useEffect(() => {
    const statusSub = addNativeSttListener('status', event => {
      if (__DEV__) console.log(`[NativeSTT] status: ${event.status}`);
      nativeStatusRef.current = event.status;
      emitToWeb({ type: 'status', status: event.status });
    });

    const messageSub = addNativeSttListener('message', event => {
      emitToWeb({ type: 'message', raw: event.raw });
    });

    const errorSub = addNativeSttListener('error', event => {
      if (__DEV__) console.log(`[NativeSTT] error: ${event.message}`);
      nativeStatusRef.current = 'error';
      emitToWeb({ type: 'error', message: event.message });
    });

    const closeSub = addNativeSttListener('close', event => {
      if (__DEV__) console.log(`[NativeSTT] close: ${event.reason}`);
      nativeStatusRef.current = 'closed';
      emitToWeb({ type: 'close', reason: event.reason });
    });

    return () => {
      statusSub.remove();
      messageSub.remove();
      errorSub.remove();
      closeSub.remove();
    };
  }, [emitToWeb]);

  useEffect(() => {
    const finishedSub = addNativeTtsListener('ttsPlaybackFinished', (event) => {
      const { utteranceId, playbackId } = resolveCurrentTtsIdentity(event);
      if (__DEV__) {
        console.log(`[NativeTTS] finished utteranceId=${utteranceId} playbackId=${playbackId} success=${event.success}`);
      }
      emitTtsToWeb({ type: 'tts_ended', utteranceId: utteranceId || '', playbackId: playbackId || '' });
    });

    const stoppedSub = addNativeTtsListener('ttsPlaybackStopped', (event) => {
      const { utteranceId, playbackId } = resolveCurrentTtsIdentity(event);
      emitTtsToWeb({ type: 'tts_stopped', utteranceId: utteranceId || '', playbackId: playbackId || '' });
    });

    const errorSub = addNativeTtsListener('ttsError', (event) => {
      const { utteranceId, playbackId } = resolveCurrentTtsIdentity(event);
      if (__DEV__) {
        console.log(`[NativeTTS] error playbackId=${playbackId}: ${event.message}`);
      }
      emitTtsToWeb({ type: 'tts_error', utteranceId: utteranceId || '', playbackId: playbackId || '', message: event.message });
    });

    return () => {
      finishedSub.remove();
      stoppedSub.remove();
      errorSub.remove();
    };
  }, [emitTtsToWeb, resolveCurrentTtsIdentity]);

  const handleLoadEnd = useCallback(() => {
    isPageReadyRef.current = true;
    emitToWeb({ type: 'status', status: nativeStatusRef.current });
  }, [emitToWeb]);

  const handleLoadError = useCallback((event: { nativeEvent: { description?: string } }) => {
    const description = event.nativeEvent.description || 'webview_load_failed';
    setLoadError(description);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <WebView
        ref={webViewRef}
        source={webUrl
          ? { uri: webUrl }
          : { html: '<html><body style="margin:0;background:#fff;"></body></html>' }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures={false}
        onMessage={handleWebMessage}
        onLoadEnd={handleLoadEnd}
        onError={handleLoadError}
        style={styles.webView}
      />
      {loadError ? (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>WebView Load Failed</Text>
          <Text style={styles.errorDescription}>{loadError}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webView: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  errorOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    backgroundColor: 'rgba(17, 24, 39, 0.9)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  errorTitle: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '700',
  },
  errorDescription: {
    color: '#d1d5db',
    fontSize: 12,
    lineHeight: 16,
  },
});

export default App;
