import type { NativeOAuthProvider } from "@/lib/native-auth-bridge";

const PENDING_TTL_MS = 10 * 60 * 1000;

export type PendingNativeAuthResult =
  | {
      status: "success";
      provider: NativeOAuthProvider;
      callbackUrl: string;
      bridgeToken: string;
    }
  | {
      status: "error";
      provider?: NativeOAuthProvider;
      callbackUrl: string;
      message: string;
    };

type PendingEntry = {
  expiresAt: number;
  result: PendingNativeAuthResult;
};

type PendingStoreGlobal = typeof globalThis & {
  __MINGLE_NATIVE_AUTH_PENDING_RESULTS__?: Map<string, PendingEntry>;
};

function getPendingResultsStore(): Map<string, PendingEntry> {
  const globalScope = globalThis as PendingStoreGlobal;
  if (!globalScope.__MINGLE_NATIVE_AUTH_PENDING_RESULTS__) {
    globalScope.__MINGLE_NATIVE_AUTH_PENDING_RESULTS__ = new Map<string, PendingEntry>();
  }
  return globalScope.__MINGLE_NATIVE_AUTH_PENDING_RESULTS__;
}

function cleanupExpired(store: Map<string, PendingEntry>, now: number) {
  for (const [requestId, entry] of store.entries()) {
    if (entry.expiresAt <= now) {
      store.delete(requestId);
    }
  }
}

export function savePendingNativeAuthResult(requestId: string, result: PendingNativeAuthResult) {
  const pendingResults = getPendingResultsStore();
  const now = Date.now();
  cleanupExpired(pendingResults, now);
  pendingResults.set(requestId, {
    expiresAt: now + PENDING_TTL_MS,
    result,
  });
}

export function consumePendingNativeAuthResult(requestId: string): PendingNativeAuthResult | null {
  const pendingResults = getPendingResultsStore();
  const now = Date.now();
  cleanupExpired(pendingResults, now);
  const entry = pendingResults.get(requestId);
  if (!entry) return null;
  pendingResults.delete(requestId);
  return entry.result;
}
