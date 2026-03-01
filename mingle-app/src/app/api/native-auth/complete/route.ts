import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "@/lib/auth-options";
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
  requestId?: string;
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
  if (params.requestId) {
    redirectUrl.searchParams.set("requestId", params.requestId);
  }
  return redirectUrl;
}

function redirectToApp(params: {
  status: "success" | "error";
  provider?: NativeOAuthProvider;
  callbackUrl?: string;
  token?: string;
  message?: string;
  requestId?: string;
}): NextResponse {
  const redirectUrl = buildAppRedirect(params).toString();
  // Some iOS browsers can keep a blank tab after custom-scheme redirects.
  // Render an auto-open page with a visible fallback button to reliably return to the app.
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0;url=${redirectUrl}" />
    <title>Return to Mingle</title>
    <style>
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fff; color: #111827; }
      main { min-height: 100dvh; display: grid; place-items: center; padding: 24px; text-align: center; }
      .card { max-width: 320px; width: 100%; border: 1px solid #e5e7eb; border-radius: 16px; padding: 18px; background: #f9fafb; }
      h1 { margin: 0; font-size: 18px; }
      p { margin: 8px 0 0; font-size: 14px; color: #4b5563; line-height: 1.45; }
      a { display: inline-block; margin-top: 14px; background: #111827; color: #fff; text-decoration: none; border-radius: 10px; padding: 10px 14px; font-size: 14px; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>Returning to Mingle</h1>
        <p>If the app does not open automatically, tap the button below.</p>
        <a href="${redirectUrl}" id="open-app">Open Mingle App</a>
      </section>
    </main>
    <script>
      const url = ${JSON.stringify(redirectUrl)};
      const tryOpen = () => { window.location.href = url; };
      tryOpen();
      setTimeout(tryOpen, 300);
      setTimeout(tryOpen, 900);
    </script>
  </body>
</html>`;
  const response = new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
  response.headers.set("cache-control", "no-store, max-age=0, must-revalidate");
  response.headers.set("pragma", "no-cache");
  response.headers.set("expires", "0");
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
      await savePendingNativeAuthResult(requestId, {
        status: "error",
        callbackUrl,
        message: "invalid_provider",
      });
    }
    return redirectToApp({
      status: "error",
      callbackUrl,
      message: "invalid_provider",
      requestId: requestId ?? undefined,
    });
  }

  const session = await getServerSession(getAuthOptions());
  if (!session?.user) {
    console.warn(`[native-auth/complete] missing session provider=${provider}`);
    if (requestId) {
      await savePendingNativeAuthResult(requestId, {
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
      requestId: requestId ?? undefined,
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
      await savePendingNativeAuthResult(requestId, {
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
      requestId: requestId ?? undefined,
    });
  }

  console.info(
    `[native-auth/complete] success provider=${provider} callbackUrl=${callbackUrl} hasEmail=${email ? "1" : "0"}`,
  );
  if (requestId) {
    await savePendingNativeAuthResult(requestId, {
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
    requestId: requestId ?? undefined,
  });
}
