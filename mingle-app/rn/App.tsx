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
import {
  startNativeBrowserAuthSession,
  type NativeAuthProvider,
} from './src/nativeAuth';
import { validateRnApiNamespace } from './src/apiNamespace';

type RuntimeEnvMap = Record<string, string | undefined>;
type NativeRuntimeConfig = {
  webAppBaseUrl?: string;
  defaultWsUrl?: string;
  apiNamespace?: string;
  clientVersion?: string;
  clientBuild?: string;
};
type VersionPolicyAction = 'force_update' | 'recommend_update' | 'none';
type VersionGateState =
  | { status: 'checking' }
  | { status: 'ready' }
  | {
      status: 'force_update';
      updateUrl: string;
      title: string;
      message: string;
      updateButtonLabel: string;
      clientVersion: string;
      latestVersion: string;
    };
type VersionPolicyResponse = {
  action: VersionPolicyAction;
  locale?: string;
  updateUrl?: string;
  title?: string;
  message?: string;
  latestVersion?: string;
  clientVersion?: string;
  updateButtonLabel?: string;
  laterButtonLabel?: string;
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

function readNativeRuntimeConfig(): NativeRuntimeConfig {
  const runtimeConfig = (NativeModules.NativeSTTModule as
    | {
        runtimeConfig?: NativeRuntimeConfig;
      }
    | undefined)?.runtimeConfig;
  if (!runtimeConfig || typeof runtimeConfig !== 'object') {
    return {};
  }
  return runtimeConfig;
}

function normalizeConfiguredUrl(
  raw: string,
  allowedProtocols: string[],
  options?: { trimTrailingSlash?: boolean },
): string {
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

function resolveConfiguredUrl(
  keys: string[],
  allowedProtocols: string[],
  options?: { trimTrailingSlash?: boolean },
): string {
  return normalizeConfiguredUrl(readRuntimeEnvValue(keys), allowedProtocols, options);
}

const RN_RUNTIME_OS = Platform.OS;
const NATIVE_RUNTIME_CONFIG = readNativeRuntimeConfig();
const WEB_APP_BASE_URL = resolveConfiguredUrl(
  ['NEXT_PUBLIC_SITE_URL', 'RN_WEB_APP_BASE_URL'],
  ['http:', 'https:'],
  { trimTrailingSlash: true },
) || normalizeConfiguredUrl(
  NATIVE_RUNTIME_CONFIG.webAppBaseUrl || '',
  ['http:', 'https:'],
  { trimTrailingSlash: true },
) || 'https://mingle-app-xi.vercel.app';
const DEFAULT_WS_URL = resolveConfiguredUrl(
  ['NEXT_PUBLIC_WS_URL', 'RN_DEFAULT_WS_URL'],
  ['ws:', 'wss:'],
) || normalizeConfiguredUrl(
  NATIVE_RUNTIME_CONFIG.defaultWsUrl || '',
  ['ws:', 'wss:'],
) || 'wss://mingle.up.railway.app';
const {
  expectedApiNamespace: EXPECTED_API_NAMESPACE,
  configuredApiNamespace: CONFIGURED_API_NAMESPACE,
  validatedApiNamespace: VALIDATED_API_NAMESPACE,
} = validateRnApiNamespace({
  runtimeOs: RN_RUNTIME_OS,
  configuredApiNamespace: readRuntimeEnvValue(['NEXT_PUBLIC_API_NAMESPACE', 'RN_API_NAMESPACE'])
    || (NATIVE_RUNTIME_CONFIG.apiNamespace || '').trim(),
});

const missingRuntimeConfig: string[] = [];
if (!WEB_APP_BASE_URL) {
  missingRuntimeConfig.push('NEXT_PUBLIC_SITE_URL');
}
if (!DEFAULT_WS_URL) {
  missingRuntimeConfig.push('NEXT_PUBLIC_WS_URL');
}
if (EXPECTED_API_NAMESPACE && !CONFIGURED_API_NAMESPACE) {
  missingRuntimeConfig.push(`NEXT_PUBLIC_API_NAMESPACE (expected: ${EXPECTED_API_NAMESPACE})`);
} else if (EXPECTED_API_NAMESPACE && !VALIDATED_API_NAMESPACE) {
  missingRuntimeConfig.push(`NEXT_PUBLIC_API_NAMESPACE must match current platform namespace: ${EXPECTED_API_NAMESPACE}`);
}
const REQUIRED_CONFIG_ERROR = missingRuntimeConfig.length > 0
  ? `Missing or invalid env: ${missingRuntimeConfig.join(', ')}`
  : null;

const NATIVE_STT_EVENT = 'mingle:native-stt';
const NATIVE_TTS_EVENT = 'mingle:native-tts';
const NATIVE_UI_EVENT = 'mingle:native-ui';
const NATIVE_AUTH_EVENT = 'mingle:native-auth';
const IOS_SAFE_BROWSER_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const WEB_SUPPORTED_LOCALES = new Set(['ko', 'en', 'ja']);
const VERSION_POLICY_SUPPORTED_LOCALES = new Set([
  'ko',
  'en',
  'ja',
  'zh-CN',
  'zh-TW',
  'fr',
  'de',
  'es',
  'pt',
  'it',
  'ru',
  'ar',
  'hi',
  'th',
  'vi',
]);
const VERSION_POLICY_LOCALE_ALIASES: Record<string, string> = {
  ko: 'ko',
  en: 'en',
  ja: 'ja',
  fr: 'fr',
  de: 'de',
  es: 'es',
  pt: 'pt',
  it: 'it',
  ru: 'ru',
  ar: 'ar',
  hi: 'hi',
  th: 'th',
  vi: 'vi',
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-sg': 'zh-CN',
  'zh-tw': 'zh-TW',
  'zh-hant': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
};
const VERSION_POLICY_FALLBACK_COPY: Record<string, {
  forceTitle: string;
  forceMessage: string;
  recommendTitle: string;
  recommendMessage: string;
  updateLabel: string;
  laterLabel: string;
}> = {
  ko: {
    forceTitle: '업데이트 필요',
    forceMessage: '현재 버전은 더 이상 지원되지 않습니다. 최신 버전으로 업데이트해 주세요.',
    recommendTitle: '업데이트 권장',
    recommendMessage: '새 버전 업데이트를 권장합니다.',
    updateLabel: '업데이트',
    laterLabel: '나중에',
  },
  en: {
    forceTitle: 'Update Required',
    forceMessage: 'This version is no longer supported. Please update to the latest version.',
    recommendTitle: 'Update Recommended',
    recommendMessage: 'A new version is available. We recommend updating for a better experience.',
    updateLabel: 'Update',
    laterLabel: 'Later',
  },
  ja: {
    forceTitle: 'アップデートが必要です',
    forceMessage: 'このバージョンはサポートされていません。最新バージョンにアップデートしてください。',
    recommendTitle: 'アップデート推奨',
    recommendMessage: '新しいバージョンが利用可能です。アップデートをお勧めします。',
    updateLabel: 'アップデート',
    laterLabel: 'あとで',
  },
  'zh-CN': {
    forceTitle: '更新必需',
    forceMessage: '当前版本已不再受支持。请更新到最新版本。',
    recommendTitle: '建议更新',
    recommendMessage: '新版本已发布，建议更新以获得更稳定的体验。',
    updateLabel: '更新',
    laterLabel: '稍后',
  },
  'zh-TW': {
    forceTitle: '必須更新',
    forceMessage: '目前版本已不再支援。請更新至最新版本。',
    recommendTitle: '建議更新',
    recommendMessage: '新版本已推出，建議更新以獲得更穩定的體驗。',
    updateLabel: '更新',
    laterLabel: '稍後',
  },
  fr: {
    forceTitle: 'Mise à jour requise',
    forceMessage: 'Cette version n\'est plus prise en charge. Veuillez mettre à jour vers la dernière version.',
    recommendTitle: 'Mise à jour recommandée',
    recommendMessage: 'Une nouvelle version est disponible. Nous recommandons la mise à jour.',
    updateLabel: 'Mettre à jour',
    laterLabel: 'Plus tard',
  },
  de: {
    forceTitle: 'Update erforderlich',
    forceMessage: 'Diese Version wird nicht mehr unterstützt. Bitte aktualisieren Sie auf die neueste Version.',
    recommendTitle: 'Update empfohlen',
    recommendMessage: 'Eine neue Version ist verfügbar. Wir empfehlen ein Update.',
    updateLabel: 'Aktualisieren',
    laterLabel: 'Später',
  },
  es: {
    forceTitle: 'Actualización obligatoria',
    forceMessage: 'Esta versión ya no es compatible. Actualiza a la última versión.',
    recommendTitle: 'Actualización recomendada',
    recommendMessage: 'Hay una nueva versión disponible. Recomendamos actualizar.',
    updateLabel: 'Actualizar',
    laterLabel: 'Más tarde',
  },
  pt: {
    forceTitle: 'Atualização obrigatória',
    forceMessage: 'Esta versão não é mais compatível. Atualize para a versão mais recente.',
    recommendTitle: 'Atualização recomendada',
    recommendMessage: 'Há uma nova versão disponível. Recomendamos atualizar.',
    updateLabel: 'Atualizar',
    laterLabel: 'Mais tarde',
  },
  it: {
    forceTitle: 'Aggiornamento obbligatorio',
    forceMessage: 'Questa versione non è più supportata. Aggiorna all\'ultima versione.',
    recommendTitle: 'Aggiornamento consigliato',
    recommendMessage: 'È disponibile una nuova versione. Ti consigliamo di aggiornare.',
    updateLabel: 'Aggiorna',
    laterLabel: 'Più tardi',
  },
  ru: {
    forceTitle: 'Требуется обновление',
    forceMessage: 'Эта версия больше не поддерживается. Обновите приложение до последней версии.',
    recommendTitle: 'Рекомендуется обновление',
    recommendMessage: 'Доступна новая версия. Рекомендуем обновить приложение.',
    updateLabel: 'Обновить',
    laterLabel: 'Позже',
  },
  ar: {
    forceTitle: 'التحديث مطلوب',
    forceMessage: 'هذا الإصدار لم يعد مدعومًا. يرجى التحديث إلى أحدث إصدار.',
    recommendTitle: 'يوصى بالتحديث',
    recommendMessage: 'يتوفر إصدار جديد. نوصي بالتحديث.',
    updateLabel: 'تحديث',
    laterLabel: 'لاحقًا',
  },
  hi: {
    forceTitle: 'अपडेट आवश्यक',
    forceMessage: 'यह संस्करण अब समर्थित नहीं है। कृपया नवीनतम संस्करण में अपडेट करें।',
    recommendTitle: 'अपडेट की अनुशंसा',
    recommendMessage: 'नया संस्करण उपलब्ध है। अपडेट करने की सलाह दी जाती है।',
    updateLabel: 'अपडेट करें',
    laterLabel: 'बाद में',
  },
  th: {
    forceTitle: 'จำเป็นต้องอัปเดต',
    forceMessage: 'เวอร์ชันนี้ไม่รองรับแล้ว กรุณาอัปเดตเป็นเวอร์ชันล่าสุด',
    recommendTitle: 'แนะนำให้อัปเดต',
    recommendMessage: 'มีเวอร์ชันใหม่พร้อมใช้งาน แนะนำให้อัปเดต',
    updateLabel: 'อัปเดต',
    laterLabel: 'ภายหลัง',
  },
  vi: {
    forceTitle: 'Cần cập nhật',
    forceMessage: 'Phiên bản này không còn được hỗ trợ. Vui lòng cập nhật lên phiên bản mới nhất.',
    recommendTitle: 'Khuyến nghị cập nhật',
    recommendMessage: 'Đã có phiên bản mới. Chúng tôi khuyên bạn nên cập nhật.',
    updateLabel: 'Cập nhật',
    laterLabel: 'Để sau',
  },
};

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

type NativeAuthStartCommand = {
  type: 'native_auth_start';
  payload: {
    provider: NativeAuthProvider;
    callbackUrl?: string;
    startUrl: string;
  };
};

type WebViewCommand = NativeSttCommand | NativeTtsCommand | NativeSttAecCommand | NativeAuthStartCommand;

type NativeSttEvent =
  | { type: 'status'; status: string }
  | { type: 'message'; raw: string }
  | { type: 'error'; message: string }
  | { type: 'close'; reason: string };

type NativeUiEvent = {
  type: 'scroll_to_top';
  source: string;
};

type NativeAuthEvent =
  | {
      type: 'status';
      provider: NativeAuthProvider;
      status: 'opening';
    }
  | {
      type: 'success';
      provider: NativeAuthProvider;
      callbackUrl: string;
      bridgeToken: string;
    }
  | {
      type: 'error';
      provider: NativeAuthProvider;
      message: string;
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

function resolveDeviceLocaleTag(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'ko';
  } catch {
    return 'ko';
  }
}

function resolveWebLocaleSegment(rawLocaleTag: string): string {
  const code = rawLocaleTag.trim().replace(/_/g, '-').split('-')[0]?.toLowerCase() || 'ko';
  return WEB_SUPPORTED_LOCALES.has(code) ? code : 'ko';
}

function resolveVersionPolicyLocale(rawLocaleTag: string): string {
  const normalized = rawLocaleTag.trim().replace(/_/g, '-').toLowerCase();
  if (!normalized) return 'en';

  const directMatch = VERSION_POLICY_LOCALE_ALIASES[normalized];
  if (directMatch && VERSION_POLICY_SUPPORTED_LOCALES.has(directMatch)) {
    return directMatch;
  }

  if (normalized.startsWith('zh-')) {
    if (normalized.includes('-tw') || normalized.includes('-hant') || normalized.includes('-hk') || normalized.includes('-mo')) {
      return 'zh-TW';
    }
    return 'zh-CN';
  }

  const base = normalized.split('-')[0] || '';
  const baseMatch = VERSION_POLICY_LOCALE_ALIASES[base];
  if (baseMatch && VERSION_POLICY_SUPPORTED_LOCALES.has(baseMatch)) {
    return baseMatch;
  }

  return 'en';
}

function getVersionPolicyFallbackCopy(locale: string) {
  return VERSION_POLICY_FALLBACK_COPY[locale] || VERSION_POLICY_FALLBACK_COPY.en;
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
  const nativeAuthInFlightRef = useRef<NativeAuthProvider | null>(null);
  const pendingAuthEventRef = useRef<NativeAuthEvent | null>(null);
  const [iosTopTapOverlayHeight, setIosTopTapOverlayHeight] = useState(() => {
    if (Platform.OS !== 'ios') return 36;
    const manager = (NativeModules as {
      StatusBarManager?: { HEIGHT?: number };
    }).StatusBarManager;
    return resolveIosTopTapOverlayHeight(manager?.HEIGHT);
  });

  const deviceLocaleTag = useMemo(() => resolveDeviceLocaleTag(), []);
  const webLocale = useMemo(() => resolveWebLocaleSegment(deviceLocaleTag), [deviceLocaleTag]);
  const versionPolicyLocale = useMemo(() => resolveVersionPolicyLocale(deviceLocaleTag), [deviceLocaleTag]);
  const versionPolicyFallback = useMemo(
    () => getVersionPolicyFallbackCopy(versionPolicyLocale),
    [versionPolicyLocale],
  );
  const webUrl = useMemo(() => {
    if (!WEB_APP_BASE_URL || REQUIRED_CONFIG_ERROR) return '';
    const apiNamespaceQuery = VALIDATED_API_NAMESPACE
      ? `&apiNamespace=${encodeURIComponent(VALIDATED_API_NAMESPACE)}`
      : '';
    const debugParams = __DEV__ ? '&sttDebug=1&ttsDebug=1' : '';
    return `${WEB_APP_BASE_URL}/${webLocale}?nativeStt=1&nativeUi=1&nativeAuth=1${apiNamespaceQuery}${debugParams}`;
  }, [webLocale]);

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
        locale: versionPolicyLocale,
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
              : versionPolicyFallback.forceMessage,
            title: typeof policy.title === 'string' && policy.title.trim()
              ? policy.title.trim()
              : versionPolicyFallback.forceTitle,
            updateButtonLabel: typeof policy.updateButtonLabel === 'string' && policy.updateButtonLabel.trim()
              ? policy.updateButtonLabel.trim()
              : versionPolicyFallback.updateLabel,
            clientVersion: typeof policy.clientVersion === 'string' ? policy.clientVersion : clientVersion,
            latestVersion: typeof policy.latestVersion === 'string' ? policy.latestVersion : '',
          });
          return;
        }

        setVersionGate({ status: 'ready' });
        if (policy.action === 'recommend_update' && !recommendPromptShownRef.current) {
          recommendPromptShownRef.current = true;
          const updateUrl = typeof policy.updateUrl === 'string' ? policy.updateUrl : '';
          const alertTitle = typeof policy.title === 'string' && policy.title.trim()
            ? policy.title.trim()
            : versionPolicyFallback.recommendTitle;
          const message = typeof policy.message === 'string' && policy.message.trim()
            ? policy.message.trim()
            : versionPolicyFallback.recommendMessage;
          const updateLabel = typeof policy.updateButtonLabel === 'string' && policy.updateButtonLabel.trim()
            ? policy.updateButtonLabel.trim()
            : versionPolicyFallback.updateLabel;
          const laterLabel = typeof policy.laterButtonLabel === 'string' && policy.laterButtonLabel.trim()
            ? policy.laterButtonLabel.trim()
            : versionPolicyFallback.laterLabel;
          if (updateUrl) {
            Alert.alert(
              alertTitle,
              message,
              [
                { text: laterLabel, style: 'cancel' },
                {
                  text: updateLabel,
                  onPress: () => {
                    void Linking.openURL(updateUrl);
                  },
                },
              ],
            );
          } else {
            Alert.alert(alertTitle, message);
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

  const dispatchAuthToWeb = useCallback((payload: NativeAuthEvent) => {
    const serialized = JSON.stringify(payload);
    if (__DEV__) {
      console.log(`[NativeAuth→Web] ${JSON.stringify(payload).slice(0, 160)}`);
    }
    const script = `window.__MINGLE_LAST_NATIVE_AUTH_EVENT = ${serialized}; window.dispatchEvent(new CustomEvent(${JSON.stringify(NATIVE_AUTH_EVENT)}, { detail: ${serialized} })); true;`;
    webViewRef.current?.injectJavaScript(script);
  }, []);

  const emitAuthToWeb = useCallback((payload: NativeAuthEvent) => {
    if (!isPageReadyRef.current) {
      pendingAuthEventRef.current = payload;
      if (__DEV__) {
        console.log(`[NativeAuth→Web] queued (page not ready) ${JSON.stringify(payload).slice(0, 160)}`);
      }
      return;
    }
    pendingAuthEventRef.current = null;
    dispatchAuthToWeb(payload);
  }, [dispatchAuthToWeb]);

  const flushPendingAuthToWeb = useCallback(() => {
    if (!isPageReadyRef.current) return;
    const pending = pendingAuthEventRef.current;
    if (!pending) return;
    pendingAuthEventRef.current = null;
    dispatchAuthToWeb(pending);
  }, [dispatchAuthToWeb]);

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
      emitToWeb({ type: 'error', message: 'missing_ws_url_env(NEXT_PUBLIC_WS_URL)' });
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

  const handleNativeAuthStart = useCallback(async (payload?: {
    provider?: NativeAuthProvider;
    callbackUrl?: string;
    startUrl?: string;
  }) => {
    const provider = payload?.provider === 'google' || payload?.provider === 'apple'
      ? payload.provider
      : null;
    if (!provider) {
      return;
    }

    if (nativeAuthInFlightRef.current) {
      emitAuthToWeb({
        type: 'error',
        provider,
        message: 'native_auth_already_in_flight',
      });
      return;
    }

    const startUrl = typeof payload?.startUrl === 'string' ? payload.startUrl.trim() : '';
    if (!startUrl) {
      emitAuthToWeb({
        type: 'error',
        provider,
        message: 'native_auth_missing_start_url',
      });
      return;
    }

    nativeAuthInFlightRef.current = provider;
    emitAuthToWeb({
      type: 'status',
      provider,
      status: 'opening',
    });
    try {
      const result = await startNativeBrowserAuthSession({
        provider,
        startUrl,
      });
      emitAuthToWeb({
        type: 'success',
        provider: result.provider,
        callbackUrl: result.callbackUrl,
        bridgeToken: result.bridgeToken,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      emitAuthToWeb({
        type: 'error',
        provider,
        message: message || 'native_auth_failed',
      });
    } finally {
      nativeAuthInFlightRef.current = null;
    }
  }, [emitAuthToWeb]);

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
      return;
    }

    if (parsed.type === 'native_auth_start') {
      if (__DEV__) {
        console.log(`[Web→NativeAuth] ${parsed.type}`, JSON.stringify(parsed.payload ?? {}).slice(0, 120));
      }
      void handleNativeAuthStart(parsed.payload);
    }
  }, [emitTtsToWeb, handleNativeAuthStart, handleNativeStart, handleNativeStop]);

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

  const handleLoadStart = useCallback(() => {
    isPageReadyRef.current = false;
  }, []);

  const handleLoadEnd = useCallback(() => {
    isPageReadyRef.current = true;
    emitToWeb({ type: 'status', status: nativeStatusRef.current });
    flushPendingAuthToWeb();
  }, [emitToWeb, flushPendingAuthToWeb]);

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
          userAgent={Platform.OS === 'ios' ? IOS_SAFE_BROWSER_USER_AGENT : undefined}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures={false}
          onMessage={handleWebMessage}
          onLoadStart={handleLoadStart}
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
          <Text style={styles.versionTitle}>{versionGate.title}</Text>
          <Text style={styles.versionDescription}>{versionGate.message}</Text>
          {versionGate.clientVersion || versionGate.latestVersion ? (
            <Text style={styles.versionMeta}>
              {versionGate.clientVersion || 'unknown'} → {versionGate.latestVersion || 'unknown'}
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
            <Text style={styles.updateButtonText}>{versionGate.updateButtonLabel}</Text>
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
