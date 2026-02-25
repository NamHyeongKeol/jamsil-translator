import { AppState, Linking } from 'react-native';

export type NativeAuthProvider = 'apple' | 'google';

export type NativeAuthSessionResult = {
  provider: NativeAuthProvider;
  bridgeToken: string;
  callbackUrl: string;
};

type NativeAuthCallbackSuccess = NativeAuthSessionResult & {
  status: 'success';
};

type NativeAuthCallbackError = {
  status: 'error';
  provider: NativeAuthProvider;
  callbackUrl: string;
  message: string;
};

const AUTH_CALLBACK_SCHEME = 'mingleauth:';
const AUTH_CALLBACK_HOST = 'auth';
const DEFAULT_CALLBACK_URL = '/';
const DEFAULT_TIMEOUT_MS = 180_000;

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

function parseNativeAuthCallbackUrl(url: string): NativeAuthCallbackSuccess | NativeAuthCallbackError | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== AUTH_CALLBACK_SCHEME) return null;
    if (parsed.hostname.toLowerCase() !== AUTH_CALLBACK_HOST) return null;

    const provider = resolveProvider(parsed.searchParams.get('provider') || '');
    if (!provider) return null;

    const callbackUrl = resolveSafeCallbackUrl(parsed.searchParams.get('callbackUrl') || DEFAULT_CALLBACK_URL);
    const status = (parsed.searchParams.get('status') || '').trim().toLowerCase();

    if (status === 'success') {
      const bridgeToken = (parsed.searchParams.get('token') || '').trim();
      if (!bridgeToken) {
        return {
          status: 'error',
          provider,
          callbackUrl,
          message: 'native_auth_missing_bridge_token',
        };
      }
      return {
        status: 'success',
        provider,
        callbackUrl,
        bridgeToken,
      };
    }

    return {
      status: 'error',
      provider,
      callbackUrl,
      message: (parsed.searchParams.get('message') || '').trim() || 'native_auth_failed',
    };
  } catch {
    return null;
  }
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

  const timeoutMs = typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs) && args.timeoutMs > 0
    ? Math.floor(args.timeoutMs)
    : DEFAULT_TIMEOUT_MS;

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
    }, timeoutMs);

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

    void Linking.openURL(startUrl).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      settleError(message || 'native_auth_open_url_failed');
    });
  });
}
