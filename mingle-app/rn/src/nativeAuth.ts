import { AppState, Linking, NativeModules, Platform } from 'react-native';

export type NativeAuthProvider = 'apple' | 'google';

export type NativeAuthSessionResult = {
  provider: NativeAuthProvider;
  bridgeToken: string;
  callbackUrl: string;
};

type NativeAuthCallbackSuccess = NativeAuthSessionResult & {
  status: 'success';
  requestId: string | null;
};

type NativeAuthCallbackError = {
  status: 'error';
  provider: NativeAuthProvider;
  callbackUrl: string;
  message: string;
  requestId: string | null;
};

export type NativeAuthCallbackPayload = NativeAuthCallbackSuccess | NativeAuthCallbackError;

const AUTH_CALLBACK_SCHEME = 'mingleauth:';
const AUTH_CALLBACK_HOST = 'auth';
const DEFAULT_CALLBACK_URL = '/';
const DEFAULT_TIMEOUT_MS = 180_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{12,128}$/;

type NativeAuthModuleType = {
  startSession(args: {
    provider: NativeAuthProvider;
    startUrl: string;
    timeoutMs?: number;
  }): Promise<{
    provider?: string;
    callbackUrl?: string;
    bridgeToken?: string;
  }>;
};

function resolveSafeCallbackUrl(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return DEFAULT_CALLBACK_URL;
  if (!trimmed.startsWith('/')) return DEFAULT_CALLBACK_URL;
  if (trimmed.startsWith('//')) return DEFAULT_CALLBACK_URL;
  return trimmed;
}

function resolveProvider(rawValue: string): NativeAuthProvider | null {
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'google' || normalized === 'apple') {
    return normalized;
  }
  return null;
}

function resolveRequestId(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!REQUEST_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export function parseNativeAuthCallbackUrl(url: string): NativeAuthCallbackPayload | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== AUTH_CALLBACK_SCHEME) return null;
    if (parsed.hostname.toLowerCase() !== AUTH_CALLBACK_HOST) return null;

    const provider = resolveProvider(parsed.searchParams.get('provider') || '');
    if (!provider) return null;

    const callbackUrl = resolveSafeCallbackUrl(parsed.searchParams.get('callbackUrl') || DEFAULT_CALLBACK_URL);
    const requestId = resolveRequestId(parsed.searchParams.get('requestId') || '');
    const status = (parsed.searchParams.get('status') || '').trim().toLowerCase();

    if (status === 'success') {
      const bridgeToken = (parsed.searchParams.get('token') || '').trim();
      if (!bridgeToken) {
        return {
          status: 'error',
          provider,
          callbackUrl,
          message: 'native_auth_missing_bridge_token',
          requestId,
        };
      }
      return {
        status: 'success',
        provider,
        callbackUrl,
        bridgeToken,
        requestId,
      };
    }

    return {
      status: 'error',
      provider,
      callbackUrl,
      message: (parsed.searchParams.get('message') || '').trim() || 'native_auth_failed',
      requestId,
    };
  } catch {
    return null;
  }
}

function getNativeAuthModule(): NativeAuthModuleType | null {
  const moduleCandidate = (NativeModules as {
    NativeAuthModule?: NativeAuthModuleType;
  }).NativeAuthModule;
  if (!moduleCandidate) return null;
  if (typeof moduleCandidate.startSession !== 'function') return null;
  return moduleCandidate;
}

function resolveNativeModuleResult(
  rawResult: {
    provider?: string;
    callbackUrl?: string;
    bridgeToken?: string;
  } | null | undefined,
  expectedProvider: NativeAuthProvider,
): NativeAuthSessionResult {
  const provider = resolveProvider(rawResult?.provider || '') ?? expectedProvider;
  const callbackUrl = resolveSafeCallbackUrl(rawResult?.callbackUrl || DEFAULT_CALLBACK_URL);
  const bridgeToken = (rawResult?.bridgeToken || '').trim();
  if (!bridgeToken) {
    throw new Error('native_auth_missing_bridge_token');
  }
  return {
    provider,
    callbackUrl,
    bridgeToken,
  };
}

async function startNativeAuthSessionWithLinking(args: {
  provider: NativeAuthProvider;
  startUrl: string;
  expectedRequestId: string | null;
  timeoutMs: number;
}): Promise<NativeAuthSessionResult> {
  return new Promise<NativeAuthSessionResult>((resolve, reject) => {
    let settled = false;
    let cleanup = () => {};
    let lastHandledUrl = '';

    const settleSuccess = (result: NativeAuthSessionResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const settleError = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const handleIncomingUrl = (incomingUrl: string) => {
      if (!incomingUrl) return;
      if (incomingUrl === lastHandledUrl) return;
      const parsed = parseNativeAuthCallbackUrl(incomingUrl);
      if (!parsed) return;
      if (parsed.provider !== args.provider) return;
      if (args.expectedRequestId && parsed.requestId !== args.expectedRequestId) return;
      lastHandledUrl = incomingUrl;

      if (parsed.status === 'success') {
        settleSuccess({
          provider: parsed.provider,
          callbackUrl: parsed.callbackUrl,
          bridgeToken: parsed.bridgeToken,
        });
        return;
      }

      settleError(parsed.message || 'native_auth_failed');
    };

    const urlSubscription = Linking.addEventListener('url', event => {
      handleIncomingUrl(event.url);
    });
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      void Linking.getInitialURL()
        .then((initialUrl) => {
          if (!initialUrl) return;
          handleIncomingUrl(initialUrl);
        })
        .catch(() => {
          // no-op: keep waiting for regular url events or timeout
        });
    });
    const timeoutHandle = setTimeout(() => {
      settleError('native_auth_timeout');
    }, args.timeoutMs);

    void Linking.getInitialURL()
      .then((initialUrl) => {
        if (!initialUrl) return;
        handleIncomingUrl(initialUrl);
      })
      .catch(() => {
        // no-op: regular url events still handled
      });

    cleanup = () => {
      urlSubscription.remove();
      appStateSubscription.remove();
      clearTimeout(timeoutHandle);
    };

    void Linking.openURL(args.startUrl).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      settleError(message || 'native_auth_open_url_failed');
    });
  });
}

export async function startNativeBrowserAuthSession(args: {
  provider: NativeAuthProvider;
  startUrl: string;
  timeoutMs?: number;
}): Promise<NativeAuthSessionResult> {
  const startUrl = args.startUrl.trim();
  if (!startUrl) {
    throw new Error('native_auth_missing_start_url');
  }

  let parsedStartUrl: URL;
  try {
    parsedStartUrl = new URL(startUrl);
  } catch {
    throw new Error('native_auth_invalid_start_url');
  }
  if (parsedStartUrl.protocol !== 'http:' && parsedStartUrl.protocol !== 'https:') {
    throw new Error('native_auth_invalid_start_url_protocol');
  }

  const expectedRequestId = resolveRequestId(parsedStartUrl.searchParams.get('requestId') || '');
  const timeoutMs = typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs) && args.timeoutMs > 0
    ? Math.floor(args.timeoutMs)
    : DEFAULT_TIMEOUT_MS;

  const nativeAuthModule = Platform.OS === 'ios'
    ? getNativeAuthModule()
    : null;
  if (nativeAuthModule) {
    try {
      const nativeResult = await nativeAuthModule.startSession({
        provider: args.provider,
        startUrl,
        timeoutMs,
      });
      return resolveNativeModuleResult(nativeResult, args.provider);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error((message || 'native_auth_failed').trim());
    }
  }

  return startNativeAuthSessionWithLinking({
    provider: args.provider,
    startUrl,
    expectedRequestId,
    timeoutMs,
  });
}
