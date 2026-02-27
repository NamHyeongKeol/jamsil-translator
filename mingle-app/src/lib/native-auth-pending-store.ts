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
  await prisma.nativeAuthPendingResult.deleteMany({
    where: {
      expiresAt: {
        lte: now,
      },
    },
  });
}

export async function savePendingNativeAuthResult(requestId: string, result: PendingNativeAuthResult) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PENDING_TTL_MS);
  await cleanupExpired(now);

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
}

export async function consumePendingNativeAuthResult(requestId: string): Promise<PendingNativeAuthResult | null> {
  const now = new Date();
  await cleanupExpired(now);

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
}
