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

const pendingResults = new Map<string, PendingEntry>();

function cleanupExpired(now: number) {
  for (const [requestId, entry] of pendingResults.entries()) {
    if (entry.expiresAt <= now) {
      pendingResults.delete(requestId);
    }
  }
}

export function savePendingNativeAuthResult(requestId: string, result: PendingNativeAuthResult) {
  const now = Date.now();
  cleanupExpired(now);
  pendingResults.set(requestId, {
    expiresAt: now + PENDING_TTL_MS,
    result,
  });
}

export function consumePendingNativeAuthResult(requestId: string): PendingNativeAuthResult | null {
  const now = Date.now();
  cleanupExpired(now);
  const entry = pendingResults.get(requestId);
  if (!entry) return null;
  pendingResults.delete(requestId);
  return entry.result;
}
