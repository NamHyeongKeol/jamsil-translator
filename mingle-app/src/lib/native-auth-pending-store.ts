import { Prisma } from "@prisma/client";
import type { NativeOAuthProvider } from "@/lib/native-auth-bridge";
import { prisma } from "@/lib/prisma";

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
  requestId: string;
  expiresAt: number;
  result: PendingNativeAuthResult;
};

type PendingStoreGlobal = typeof globalThis & {
  __MINGLE_NATIVE_AUTH_PENDING_RESULTS_FALLBACK__?: Map<string, PendingEntry>;
  __MINGLE_NATIVE_AUTH_PENDING_RESULTS_FALLBACK_WARNED__?: boolean;
};

function getFallbackStore(): Map<string, PendingEntry> {
  const globalScope = globalThis as PendingStoreGlobal;
  if (!globalScope.__MINGLE_NATIVE_AUTH_PENDING_RESULTS_FALLBACK__) {
    globalScope.__MINGLE_NATIVE_AUTH_PENDING_RESULTS_FALLBACK__ = new Map<string, PendingEntry>();
  }
  return globalScope.__MINGLE_NATIVE_AUTH_PENDING_RESULTS_FALLBACK__;
}

function warnFallbackModeOnce() {
  const globalScope = globalThis as PendingStoreGlobal;
  if (globalScope.__MINGLE_NATIVE_AUTH_PENDING_RESULTS_FALLBACK_WARNED__) return;
  globalScope.__MINGLE_NATIVE_AUTH_PENDING_RESULTS_FALLBACK_WARNED__ = true;
  console.warn(
    "[native-auth/pending-store] fallback to in-memory store (native_auth_pending_results table missing).",
  );
}

function cleanupExpiredInMemory(nowEpochMs: number) {
  const store = getFallbackStore();
  for (const [id, entry] of store.entries()) {
    if (entry.expiresAt <= nowEpochMs) {
      store.delete(id);
    }
  }
}

function saveInMemory(requestId: string, result: PendingNativeAuthResult, expiresAtEpochMs: number) {
  cleanupExpiredInMemory(Date.now());
  getFallbackStore().set(requestId, {
    requestId,
    expiresAt: expiresAtEpochMs,
    result,
  });
}

function consumeInMemory(requestId: string): PendingNativeAuthResult | null {
  cleanupExpiredInMemory(Date.now());
  const store = getFallbackStore();
  const entry = store.get(requestId);
  if (!entry) return null;
  store.delete(requestId);
  return entry.result;
}

function isPendingTableMissingError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2021") return false;

  const table = typeof error.meta?.table === "string"
    ? error.meta.table
    : "";
  if (!table) return true;
  return table.includes("native_auth_pending_results");
}

function toPendingEntry(row: {
  requestId: string;
  status: string;
  provider: string | null;
  callbackUrl: string;
  bridgeToken: string | null;
  message: string | null;
  expiresAt: Date;
}): PendingEntry | null {
  const provider = row.provider === "apple" || row.provider === "google"
    ? row.provider
    : null;
  const expiresAt = row.expiresAt.getTime();
  if (Number.isNaN(expiresAt)) return null;

  if (row.status === "success") {
    if (!provider || !row.bridgeToken) return null;
    return {
      requestId: row.requestId,
      expiresAt,
      result: {
        status: "success",
        provider,
        callbackUrl: row.callbackUrl,
        bridgeToken: row.bridgeToken,
      },
    };
  }

  if (row.status === "error") {
    return {
      requestId: row.requestId,
      expiresAt,
      result: {
        status: "error",
        provider: provider ?? undefined,
        callbackUrl: row.callbackUrl,
        message: row.message || "native_auth_failed",
      },
    };
  }

  return null;
}

async function cleanupExpired(now: Date) {
  try {
    await prisma.nativeAuthPendingResult.deleteMany({
      where: {
        expiresAt: {
          lte: now,
        },
      },
    });
  } catch (error: unknown) {
    if (!isPendingTableMissingError(error)) throw error;
    warnFallbackModeOnce();
    cleanupExpiredInMemory(now.getTime());
  }
}

export async function savePendingNativeAuthResult(requestId: string, result: PendingNativeAuthResult) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PENDING_TTL_MS);
  await cleanupExpired(now);

  try {
    await prisma.nativeAuthPendingResult.upsert({
      where: { requestId },
      create: {
        requestId,
        status: result.status,
        provider: result.provider ?? null,
        callbackUrl: result.callbackUrl,
        bridgeToken: result.status === "success" ? result.bridgeToken : null,
        message: result.status === "error" ? result.message : null,
        expiresAt,
      },
      update: {
        status: result.status,
        provider: result.provider ?? null,
        callbackUrl: result.callbackUrl,
        bridgeToken: result.status === "success" ? result.bridgeToken : null,
        message: result.status === "error" ? result.message : null,
        expiresAt,
      },
    });
  } catch (error: unknown) {
    if (!isPendingTableMissingError(error)) throw error;
    warnFallbackModeOnce();
    saveInMemory(requestId, result, expiresAt.getTime());
  }
}

export async function consumePendingNativeAuthResult(requestId: string): Promise<PendingNativeAuthResult | null> {
  const now = new Date();
  await cleanupExpired(now);

  try {
    const row = await prisma.nativeAuthPendingResult.findUnique({
      where: { requestId },
    });
    if (!row) return null;

    await prisma.nativeAuthPendingResult.deleteMany({
      where: { requestId },
    });
    const entry = toPendingEntry(row);
    if (!entry) return null;
    if (entry.expiresAt <= now.getTime()) return null;
    return entry.result;
  } catch (error: unknown) {
    if (!isPendingTableMissingError(error)) throw error;
    warnFallbackModeOnce();
    return consumeInMemory(requestId);
  }
}
