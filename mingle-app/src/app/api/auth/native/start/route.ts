import { NextRequest, NextResponse } from "next/server";
import { resolveNativeOAuthProvider, resolveSafeCallbackPath } from "@/lib/native-auth-bridge";

export async function GET(request: NextRequest) {
  const provider = resolveNativeOAuthProvider(request.nextUrl.searchParams.get("provider"));
  if (!provider) {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }

  const callbackPath = resolveSafeCallbackPath(request.nextUrl.searchParams.get("callbackUrl"), "/");
  const completeUrl = new URL("/api/auth/native/complete", request.nextUrl.origin);
  completeUrl.searchParams.set("provider", provider);
  completeUrl.searchParams.set("callbackUrl", callbackPath);

  const signInUrl = new URL(`/api/auth/signin/${provider}`, request.nextUrl.origin);
  signInUrl.searchParams.set("callbackUrl", completeUrl.toString());

  return NextResponse.redirect(signInUrl);
}
