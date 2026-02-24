import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
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
import { validateRnApiNamespace } from './src/apiNamespace';

type RuntimeEnvMap = Record<string, string | undefined>;
type VersionPolicyAction = 'force_update' | 'recommend_update' | 'none';
type VersionGateState =
  | { status: 'checking' }
  | { status: 'ready' }
  | {
      status: 'force_update';
      updateUrl: string;
      message: string;
      clientVersion: string;
      latestVersion: string;
    };
type VersionPolicyResponse = {
  action: VersionPolicyAction;
  updateUrl?: string;
  message?: string;
  latestVersion?: string;
  clientVersion?: string;
};

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

const RN_RUNTIME_OS = Platform.OS;
const WEB_APP_BASE_URL = resolveConfiguredUrl(
  ['RN_WEB_APP_BASE_URL', 'NEXT_PUBLIC_SITE_URL'],
  ['http:', 'https:'],
  { trimTrailingSlash: true },
) || 'https://mingle-app-xi.vercel.app';
const DEFAULT_WS_URL = resolveConfiguredUrl(
  ['RN_DEFAULT_WS_URL', 'NEXT_PUBLIC_WS_URL'],
  ['ws:', 'wss:'],
) || 'wss://mingle.up.railway.app';
const {
  expectedApiNamespace: EXPECTED_API_NAMESPACE,
  configuredApiNamespace: CONFIGURED_API_NAMESPACE,
  validatedApiNamespace: VALIDATED_API_NAMESPACE,
} = validateRnApiNamespace({
  runtimeOs: RN_RUNTIME_OS,
  configuredApiNamespace: readRuntimeEnvValue(['RN_API_NAMESPACE']),
});

const missingRuntimeConfig: string[] = [];
if (!WEB_APP_BASE_URL) {
  missingRuntimeConfig.push('RN_WEB_APP_BASE_URL (or NEXT_PUBLIC_SITE_URL)');
}
if (!DEFAULT_WS_URL) {
  missingRuntimeConfig.push('RN_DEFAULT_WS_URL (or NEXT_PUBLIC_WS_URL)');
}
if (EXPECTED_API_NAMESPACE && !CONFIGURED_API_NAMESPACE) {
  missingRuntimeConfig.push(`RN_API_NAMESPACE (expected: ${EXPECTED_API_NAMESPACE})`);
} else if (EXPECTED_API_NAMESPACE && !VALIDATED_API_NAMESPACE) {
  missingRuntimeConfig.push(`RN_API_NAMESPACE must match current platform namespace: ${EXPECTED_API_NAMESPACE}`);
}
const REQUIRED_CONFIG_ERROR = missingRuntimeConfig.length > 0
  ? `Missing or invalid env: ${missingRuntimeConfig.join(', ')}`
  : null;

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

function normalizeClientVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '');
}

function buildIosVersionPolicyUrl(baseUrl: string): string {
  return `${baseUrl}/api/ios/v1.0.0/client/version-policy`;
}

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
  const [loadError, setLoadError] = useState<string | null>(REQUIRED_CONFIG_ERROR);
  const [versionGate, setVersionGate] = useState<VersionGateState>(() => (
    Platform.OS === 'ios' && WEB_APP_BASE_URL && !REQUIRED_CONFIG_ERROR
      ? { status: 'checking' }
      : { status: 'ready' }
  ));
  const recommendPromptShownRef = useRef(false);
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
    if (!WEB_APP_BASE_URL || REQUIRED_CONFIG_ERROR) return '';
    const apiNamespaceQuery = VALIDATED_API_NAMESPACE
      ? `&apiNamespace=${encodeURIComponent(VALIDATED_API_NAMESPACE)}`
      : '';
    const debugParams = __DEV__ ? '&sttDebug=1&ttsDebug=1' : '';
    return `${WEB_APP_BASE_URL}/${locale}?nativeStt=1&nativeUi=1${apiNamespaceQuery}${debugParams}`;
  }, [locale]);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !WEB_APP_BASE_URL || REQUIRED_CONFIG_ERROR) {
      return;
    }

    let active = true;
    const nativeRuntimeConfig = (NativeModules.NativeSTTModule as
      | {
          runtimeConfig?: {
            clientVersion?: string;
            clientBuild?: string;
          };
        }
      | undefined)?.runtimeConfig;
    const envClientVersion = readRuntimeEnvValue(['RN_CLIENT_VERSION']);
    const envClientBuild = readRuntimeEnvValue(['RN_CLIENT_BUILD']);
    const clientVersion = normalizeClientVersion(
      envClientVersion
      || nativeRuntimeConfig?.clientVersion
      || '',
    );
    const clientBuild = envClientBuild || nativeRuntimeConfig?.clientBuild || '';

    void fetch(buildIosVersionPolicyUrl(WEB_APP_BASE_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientVersion,
        clientBuild,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`version_policy_status_${response.status}`);
        }
        return response.json() as Promise<VersionPolicyResponse>;
      })
      .then((policy) => {
        if (!active) return;

        if (policy.action === 'force_update') {
          setVersionGate({
            status: 'force_update',
            updateUrl: typeof policy.updateUrl === 'string' ? policy.updateUrl : '',
            message: typeof policy.message === 'string' && policy.message.trim()
              ? policy.message.trim()
              : '최신 버전으로 업데이트가 필요합니다.',
            clientVersion: typeof policy.clientVersion === 'string' ? policy.clientVersion : clientVersion,
            latestVersion: typeof policy.latestVersion === 'string' ? policy.latestVersion : '',
          });
          return;
        }

        setVersionGate({ status: 'ready' });
        if (policy.action === 'recommend_update' && !recommendPromptShownRef.current) {
          recommendPromptShownRef.current = true;
          const updateUrl = typeof policy.updateUrl === 'string' ? policy.updateUrl : '';
          const message = typeof policy.message === 'string' && policy.message.trim()
            ? policy.message.trim()
            : '새 버전 업데이트를 권장합니다.';
          if (updateUrl) {
            Alert.alert(
              '업데이트 권장',
              message,
              [
                { text: '나중에', style: 'cancel' },
                {
                  text: '업데이트',
                  onPress: () => {
                    void Linking.openURL(updateUrl);
                  },
                },
              ],
            );
          } else {
            Alert.alert('업데이트 권장', message);
          }
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (__DEV__) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`[VersionPolicy] bypass due to error: ${message}`);
        }
        setVersionGate({ status: 'ready' });
      });

    return () => {
      active = false;
    };
  }, []);

  const handleForceUpdatePress = useCallback(() => {
    if (versionGate.status !== 'force_update') return;
    const updateUrl = versionGate.updateUrl.trim();
    if (!updateUrl) return;
    void Linking.openURL(updateUrl);
  }, [versionGate]);

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
      {versionGate.status === 'ready' ? (
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
      ) : (
        <View style={styles.webView} />
      )}
      {versionGate.status === 'checking' ? (
        <View style={styles.versionOverlay}>
          <Text style={styles.versionTitle}>버전 확인 중</Text>
          <Text style={styles.versionDescription}>최신 업데이트 정책을 확인하고 있습니다.</Text>
        </View>
      ) : null}
      {versionGate.status === 'force_update' ? (
        <View style={styles.versionOverlay}>
          <Text style={styles.versionTitle}>업데이트 필요</Text>
          <Text style={styles.versionDescription}>{versionGate.message}</Text>
          {versionGate.clientVersion || versionGate.latestVersion ? (
            <Text style={styles.versionMeta}>
              현재 {versionGate.clientVersion || 'unknown'} / 최신 {versionGate.latestVersion || 'unknown'}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Update now"
            onPress={handleForceUpdatePress}
            style={({ pressed }) => [
              styles.updateButton,
              pressed ? styles.updateButtonPressed : null,
            ]}
          >
            <Text style={styles.updateButtonText}>업데이트</Text>
          </Pressable>
        </View>
      ) : null}
      {versionGate.status === 'ready' && loadError ? (
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
  versionOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    backgroundColor: 'rgba(17, 24, 39, 0.94)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  versionTitle: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '700',
  },
  versionDescription: {
    color: '#d1d5db',
    fontSize: 13,
    lineHeight: 18,
  },
  versionMeta: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 16,
  },
  updateButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  updateButtonPressed: {
    opacity: 0.85,
  },
  updateButtonText: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '700',
  },
});

export default App;
