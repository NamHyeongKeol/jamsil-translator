import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import {
  createNativeAuthBridgeToken,
  resolveNativeAuthRequestId,
  resolveNativeOAuthProvider,
  resolveSafeCallbackPath,
  type NativeOAuthProvider,
} from "@/lib/native-auth-bridge";
import { savePendingNativeAuthResult } from "@/lib/native-auth-pending-store";

const APP_AUTH_CALLBACK_URL = "mingleauth://auth";

function summarizeUserAgent(rawValue: string | null): string {
  const normalized = (rawValue || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "unknown";
  return normalized.slice(0, 160);
}

function buildAppRedirect(params: {
  status: "success" | "error";
  provider?: NativeOAuthProvider;
  callbackUrl?: string;
  token?: string;
  message?: string;
}): URL {
  const redirectUrl = new URL(APP_AUTH_CALLBACK_URL);
  redirectUrl.searchParams.set("status", params.status);
  if (params.provider) {
    redirectUrl.searchParams.set("provider", params.provider);
  }
  if (params.callbackUrl) {
    redirectUrl.searchParams.set("callbackUrl", params.callbackUrl);
  }
  if (params.token) {
    redirectUrl.searchParams.set("token", params.token);
  }
  if (params.message) {
    redirectUrl.searchParams.set("message", params.message);
  }
  return redirectUrl;
}

function redirectToApp(params: {
  status: "success" | "error";
  provider?: NativeOAuthProvider;
  callbackUrl?: string;
  token?: string;
  message?: string;
}): NextResponse {
  // Use 302 for custom-scheme redirects to maximize browser compatibility on iOS.
  const response = NextResponse.redirect(buildAppRedirect(params), 302);
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}

function resolveSubject({
  sessionUserId,
  email,
  provider,
}: {
  sessionUserId: unknown;
  email: string;
  provider: NativeOAuthProvider;
}): string {
  if (typeof sessionUserId === "string" && sessionUserId.trim()) {
    return sessionUserId.trim().slice(0, 256);
  }
  if (email) {
    return `native_email_${email.toLowerCase()}`.slice(0, 256);
  }
  return `native_${provider}_${randomUUID().replaceAll("-", "")}`;
}

export async function GET(request: NextRequest) {
  const provider = resolveNativeOAuthProvider(request.nextUrl.searchParams.get("provider"));
  const callbackUrl = resolveSafeCallbackPath(request.nextUrl.searchParams.get("callbackUrl"), "/");
  const requestId = resolveNativeAuthRequestId(request.nextUrl.searchParams.get("requestId"));
  const userAgent = summarizeUserAgent(request.headers.get("user-agent"));

  console.info(
    `[native-auth/complete] begin provider=${provider ?? "invalid"} callbackUrl=${callbackUrl} requestId=${requestId || "-"} ua="${userAgent}"`,
  );

  if (!provider) {
    console.warn("[native-auth/complete] invalid provider");
    if (requestId) {
      savePendingNativeAuthResult(requestId, {
        status: "error",
        callbackUrl,
        message: "invalid_provider",
      });
    }
    return redirectToApp({
      status: "error",
      callbackUrl,
      message: "invalid_provider",
    });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    console.warn(`[native-auth/complete] missing session provider=${provider}`);
    if (requestId) {
      savePendingNativeAuthResult(requestId, {
        status: "error",
        provider,
        callbackUrl,
        message: "native_auth_session_missing",
      });
    }
    return redirectToApp({
      status: "error",
      provider,
      callbackUrl,
      message: "native_auth_session_missing",
    });
  }

  const name = typeof session.user.name === "string" ? session.user.name.trim() : "";
  const email = typeof session.user.email === "string" ? session.user.email.trim().toLowerCase() : "";
  const subject = resolveSubject({ sessionUserId: session.user.id, email, provider });

  let bridgeToken = "";
  try {
    bridgeToken = createNativeAuthBridgeToken({
      sub: subject,
      name: name || "Mingle User",
      email,
      provider,
      callbackUrl,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[native-auth/complete] bridge token creation failed provider=${provider} reason=${message}`);
    if (requestId) {
      savePendingNativeAuthResult(requestId, {
        status: "error",
        provider,
        callbackUrl,
        message: "native_auth_bridge_token_failed",
      });
    }
    return redirectToApp({
      status: "error",
      provider,
      callbackUrl,
      message: "native_auth_bridge_token_failed",
    });
  }

  console.info(
    `[native-auth/complete] success provider=${provider} callbackUrl=${callbackUrl} hasEmail=${email ? "1" : "0"}`,
  );
  if (requestId) {
    savePendingNativeAuthResult(requestId, {
      status: "success",
      provider,
      callbackUrl,
      bridgeToken,
    });
  }

  return redirectToApp({
    status: "success",
    provider,
    callbackUrl,
    token: bridgeToken,
  });
}
