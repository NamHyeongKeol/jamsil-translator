import { NextRequest, NextResponse } from "next/server";
import { resolveNativeAuthRequestId } from "@/lib/native-auth-bridge";
import { consumePendingNativeAuthResult } from "@/lib/native-auth-pending-store";

export async function GET(request: NextRequest) {
  const requestId = resolveNativeAuthRequestId(request.nextUrl.searchParams.get("requestId"));
  if (!requestId) {
    return NextResponse.json({ error: "invalid_request_id" }, { status: 400 });
  }

  const pendingResult = consumePendingNativeAuthResult(requestId);
  const response = pendingResult
    ? NextResponse.json(pendingResult)
    : NextResponse.json({ status: "pending" });
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}
