import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NativeModules,
  Platform,
  Pressable,
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
type NativeRuntimeConfig = {
  webAppBaseUrl?: string;
  defaultWsUrl?: string;
};
type ResolvedRuntimeConfig = {
  webAppBaseUrl: string;
  defaultWsUrl: string;
  error: string | null;
};

const RUNTIME_CONFIG_ERROR_PREFIX = 'Missing or invalid runtime config: ';

function readNativeRuntimeConfig(): NativeRuntimeConfig {
  const nativeSttModule = NativeModules.NativeSTTModule as
    | { runtimeConfig?: NativeRuntimeConfig }
    | undefined;
  const runtimeConfig = nativeSttModule?.runtimeConfig;
  if (!runtimeConfig || typeof runtimeConfig !== 'object') {
    return {};
  }
  return runtimeConfig;
}

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

function readNativeRuntimeValue(
  keys: Array<keyof NativeRuntimeConfig>,
  runtimeConfig: NativeRuntimeConfig = readNativeRuntimeConfig(),
): string {
  for (const key of keys) {
    const value = runtimeConfig[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

function resolveConfiguredUrl(
  sources: {
    nativeKeys?: Array<keyof NativeRuntimeConfig>;
    envKeys?: string[];
  },
  allowedProtocols: string[],
  options?: { trimTrailingSlash?: boolean },
  runtimeConfig?: NativeRuntimeConfig,
): string {
  const raw = readNativeRuntimeValue(sources.nativeKeys || [], runtimeConfig)
    || readRuntimeEnvValue(sources.envKeys || []);
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    if (!allowedProtocols.includes(parsed.protocol)) return '';
    if (!parsed.hostname) return '';
    if (options?.trimTrailingSlash) {
      return raw.replace(/\/+$/, '');
    }
    return raw;
  } catch {
    return '';
  }
}

function resolveRuntimeConfig(runtimeConfig?: NativeRuntimeConfig): ResolvedRuntimeConfig {
  const webAppBaseUrl = resolveConfiguredUrl(
    {
      nativeKeys: ['webAppBaseUrl'],
      envKeys: ['RN_WEB_APP_BASE_URL', 'NEXT_PUBLIC_SITE_URL'],
    },
    ['http:', 'https:'],
    { trimTrailingSlash: true },
    runtimeConfig,
  );
  const defaultWsUrl = resolveConfiguredUrl(
    {
      nativeKeys: ['defaultWsUrl'],
      envKeys: ['RN_DEFAULT_WS_URL', 'NEXT_PUBLIC_WS_URL'],
    },
    ['ws:', 'wss:'],
    undefined,
    runtimeConfig,
  );

  const missingRuntimeConfig: string[] = [];
  if (!webAppBaseUrl) {
    missingRuntimeConfig.push('MingleWebAppScheme/Host(Info.plist) or RN_WEB_APP_BASE_URL');
  }
  if (!defaultWsUrl) {
    missingRuntimeConfig.push('MingleDefaultWsScheme/Host(Info.plist) or RN_DEFAULT_WS_URL');
  }

  return {
    webAppBaseUrl,
    defaultWsUrl,
    error: missingRuntimeConfig.length > 0
      ? `${RUNTIME_CONFIG_ERROR_PREFIX}${missingRuntimeConfig.join(', ')}`
      : null,
  };
}

const INITIAL_RUNTIME_CONFIG = resolveRuntimeConfig();

const NATIVE_STT_EVENT = 'mingle:native-stt';
const NATIVE_TTS_EVENT = 'mingle:native-tts';
const NATIVE_UI_EVENT = 'mingle:native-ui';
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

type NativeUiEvent = {
  type: 'scroll_to_top';
  source: string;
};

function resolveIosTopTapOverlayHeight(rawStatusBarHeight: unknown): number {
  const numeric = typeof rawStatusBarHeight === 'number'
    ? rawStatusBarHeight
    : Number(rawStatusBarHeight);
  if (!Number.isFinite(numeric) || numeric <= 0) return 24;
  // iOS 상단 탭은 상태바/노치 영역 기준으로만 처리합니다.
  return Math.max(20, Math.min(64, Math.ceil(numeric)));
}

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
  const [runtimeConfig, setRuntimeConfig] = useState<ResolvedRuntimeConfig>(() => INITIAL_RUNTIME_CONFIG);
  const [loadError, setLoadError] = useState<string | null>(() => INITIAL_RUNTIME_CONFIG.error);
  const nativeStatusRef = useRef('idle');
  const currentTtsPlaybackRef = useRef<{ utteranceId: string; playbackId: string } | null>(null);
  const [iosTopTapOverlayHeight, setIosTopTapOverlayHeight] = useState(() => {
    if (Platform.OS !== 'ios') return 36;
    const manager = (NativeModules as {
      StatusBarManager?: { HEIGHT?: number };
    }).StatusBarManager;
    return resolveIosTopTapOverlayHeight(manager?.HEIGHT);
  });

  const locale = useMemo(() => resolveLocaleSegment(), []);
  const webUrl = useMemo(() => {
    if (!runtimeConfig.webAppBaseUrl) return '';
    const debugParams = __DEV__ ? '&sttDebug=1&ttsDebug=1' : '';
    return `${runtimeConfig.webAppBaseUrl}/${locale}?nativeStt=1&nativeUi=1${debugParams}`;
  }, [locale, runtimeConfig.webAppBaseUrl]);

  useEffect(() => {
    const nativeSttModule = NativeModules.NativeSTTModule as
      | { getRuntimeConfig?: () => Promise<NativeRuntimeConfig> }
      | undefined;
    if (!nativeSttModule || typeof nativeSttModule.getRuntimeConfig !== 'function') {
      return;
    }

    let active = true;
    void nativeSttModule.getRuntimeConfig()
      .then((nativeConfig) => {
        if (!active) return;
        const next = resolveRuntimeConfig(nativeConfig);
        setRuntimeConfig((current) => {
          if (
            current.webAppBaseUrl === next.webAppBaseUrl
            && current.defaultWsUrl === next.defaultWsUrl
            && current.error === next.error
          ) {
            return current;
          }
          return next;
        });
        setLoadError((current) => {
          const isRuntimeConfigError = typeof current === 'string'
            && current.startsWith(RUNTIME_CONFIG_ERROR_PREFIX);
          if (current === null || isRuntimeConfigError) {
            return next.error;
          }
          return current;
        });
      })
      .catch(() => {
        // Keep initial runtime config when native bridge lookup fails.
      });

    return () => {
      active = false;
    };
  }, []);

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

  const emitUiToWeb = useCallback((payload: NativeUiEvent) => {
    if (!isPageReadyRef.current) return;
    const serialized = JSON.stringify(payload);
    if (__DEV__) {
      console.log(`[NativeUI→Web] ${JSON.stringify(payload).slice(0, 120)}`);
    }
    const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(NATIVE_UI_EVENT)}, { detail: ${serialized} })); true;`;
    webViewRef.current?.injectJavaScript(script);
  }, []);

  const handleIosTopTapOverlayPress = useCallback(() => {
    emitUiToWeb({ type: 'scroll_to_top', source: 'ios_status_bar_overlay' });
  }, [emitUiToWeb]);

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
    if (!payloadWsUrl && !runtimeConfig.defaultWsUrl) {
      emitToWeb({ type: 'error', message: 'missing_ws_url_runtime(MingleDefaultWsScheme/Host or RN_DEFAULT_WS_URL)' });
      return;
    }

    const wsUrl = payloadWsUrl
      ? payloadWsUrl
      : runtimeConfig.defaultWsUrl;
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
  }, [emitToWeb, nativeAvailable, runtimeConfig.defaultWsUrl]);

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
    if (Platform.OS !== 'ios') return;
    let isMounted = true;
    const manager = (NativeModules as {
      StatusBarManager?: {
        HEIGHT?: number;
        getHeight?: (callback: (metrics: { height: number }) => void) => void;
      };
    }).StatusBarManager;

    if (!manager || typeof manager.getHeight !== 'function') return;

    manager.getHeight((metrics) => {
      if (!isMounted) return;
      setIosTopTapOverlayHeight(resolveIosTopTapOverlayHeight(metrics?.height));
    });
    return () => {
      isMounted = false;
    };
  }, []);

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
      {Platform.OS === 'ios' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scroll to top"
          onPress={handleIosTopTapOverlayPress}
          style={[styles.iosTopTapOverlay, { height: iosTopTapOverlayHeight }]}
        />
      ) : null}
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
  iosTopTapOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: 'transparent',
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
