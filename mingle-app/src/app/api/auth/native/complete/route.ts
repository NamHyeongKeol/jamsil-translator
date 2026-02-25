import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth-options";
import {
  createNativeAuthBridgeToken,
  resolveNativeOAuthProvider,
  resolveSafeCallbackPath,
  type NativeOAuthProvider,
} from "@/lib/native-auth-bridge";

const APP_AUTH_CALLBACK_URL = "mingleauth://auth";

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

function resolveSubject({
  jwtSubject,
  email,
  provider,
}: {
  jwtSubject: unknown;
  email: string;
  provider: NativeOAuthProvider;
}): string {
  if (typeof jwtSubject === "string" && jwtSubject.trim()) {
    return jwtSubject.trim().slice(0, 256);
  }
  if (email) {
    return `native_email_${email.toLowerCase()}`.slice(0, 256);
  }
  return `native_${provider}_${randomUUID().replaceAll("-", "")}`;
}

export async function GET(request: NextRequest) {
  const provider = resolveNativeOAuthProvider(request.nextUrl.searchParams.get("provider"));
  const callbackUrl = resolveSafeCallbackPath(request.nextUrl.searchParams.get("callbackUrl"), "/");

  if (!provider) {
    return NextResponse.redirect(buildAppRedirect({
      status: "error",
      callbackUrl,
      message: "invalid_provider",
    }));
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.redirect(buildAppRedirect({
      status: "error",
      provider,
      callbackUrl,
      message: "native_auth_session_missing",
    }));
  }

  const jwtToken = await getToken({ req: request, secret: process.env.AUTH_SECRET });
  const name = typeof session.user.name === "string" ? session.user.name.trim() : "";
  const email = typeof session.user.email === "string" ? session.user.email.trim().toLowerCase() : "";
  const subject = resolveSubject({ jwtSubject: jwtToken?.sub, email, provider });

  let bridgeToken = "";
  try {
    bridgeToken = createNativeAuthBridgeToken({
      sub: subject,
      name: name || "Mingle User",
      email,
      provider,
      callbackUrl,
    });
  } catch {
    return NextResponse.redirect(buildAppRedirect({
      status: "error",
      provider,
      callbackUrl,
      message: "native_auth_bridge_token_failed",
    }));
  }

  return NextResponse.redirect(buildAppRedirect({
    status: "success",
    provider,
    callbackUrl,
    token: bridgeToken,
  }));
}
