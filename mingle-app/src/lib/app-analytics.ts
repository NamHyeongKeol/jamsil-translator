import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const USER_COOKIE_KEY = "mingle_uid";
const SESSION_COOKIE_KEY = "mingle_sid";
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

type EnsureTrackingContextArgs = {
  sessionKeyHint?: string | null;
  externalUserIdHint?: string | null;
};

export type ClientContext = {
  language: string | null;
  pageLanguage: string | null;
  referrer: string | null;
  fullUrl: string | null;
  queryParams: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  timezone: string | null;
  platform: string | null;
  pathname: string | null;
  appVersion: string | null;
  usageSec: number | null;
};

export type TrackingContext = {
  externalUserId: string;
  sessionKey: string;
  ipAddress: string | null;
  userAgent: string | null;
  requestLocale: string | null;
  requestFullUrl: string | null;
  requestPathname: string | null;
};

function sanitizeText(value: unknown, maxLength = 512): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export function sanitizeNonNegativeInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const floored = Math.floor(value);
    return floored >= 0 ? floored : null;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return null;
    return parsed >= 0 ? parsed : null;
  }
  return null;
}

function parseAcceptLanguage(acceptLanguageHeader: string | null): string | null {
  if (!acceptLanguageHeader) return null;
  const first = acceptLanguageHeader.split(",")[0]?.split(";")[0];
  return sanitizeText(first, 32);
}

function parseRequestIp(request: NextRequest): string | null {
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const first = xForwardedFor.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  return (
    sanitizeText(request.headers.get("x-real-ip"), 128)
    || sanitizeText(request.headers.get("cf-connecting-ip"), 128)
    || sanitizeText(request.headers.get("true-client-ip"), 128)
    || null
  );
}

function isSecureRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.trim().toLowerCase() === "https";
  }
  return request.nextUrl.protocol.replace(":", "") === "https";
}

function generateStableId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function parseClientContext(raw: unknown): ClientContext {
  const payload = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  return {
    language: sanitizeText(payload.language, 32),
    pageLanguage: sanitizeText(payload.pageLanguage, 32),
    referrer: sanitizeText(payload.referrer, 1024),
    fullUrl: sanitizeText(payload.fullUrl, 2048),
    queryParams: sanitizeText(payload.queryParams, 1024),
    screenWidth: sanitizeNonNegativeInt(payload.screenWidth),
    screenHeight: sanitizeNonNegativeInt(payload.screenHeight),
    timezone: sanitizeText(payload.timezone, 128),
    platform: sanitizeText(payload.platform, 128),
    pathname: sanitizeText(payload.pathname, 1024),
    appVersion: sanitizeText(payload.appVersion, 64),
    usageSec: sanitizeNonNegativeInt(payload.usageSec),
  };
}

export function ensureTrackingContext(
  request: NextRequest,
  response: NextResponse,
  args?: EnsureTrackingContextArgs,
): TrackingContext {
  const cookieUserId = sanitizeText(request.cookies.get(USER_COOKIE_KEY)?.value, 128);
  const cookieSessionKey = sanitizeText(request.cookies.get(SESSION_COOKIE_KEY)?.value, 128);
  const headerUserId = sanitizeText(request.headers.get("x-mingle-user-id"), 128);
  const headerSessionKey = sanitizeText(request.headers.get("x-mingle-session-key"), 128);

  const externalUserId = (
    sanitizeText(args?.externalUserIdHint, 128)
    || headerUserId
    || cookieUserId
    || generateStableId("anon")
  );
  const sessionKey = (
    sanitizeText(args?.sessionKeyHint, 128)
    || headerSessionKey
    || cookieSessionKey
    || generateStableId("sess")
  );

  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureRequest(request),
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  };

  if (cookieUserId !== externalUserId) {
    response.cookies.set(USER_COOKIE_KEY, externalUserId, cookieOptions);
  }
  if (cookieSessionKey !== sessionKey) {
    response.cookies.set(SESSION_COOKIE_KEY, sessionKey, cookieOptions);
  }

  return {
    externalUserId,
    sessionKey,
    ipAddress: parseRequestIp(request),
    userAgent: sanitizeText(request.headers.get("user-agent"), 1024),
    requestLocale: parseAcceptLanguage(request.headers.get("accept-language")),
    requestFullUrl: sanitizeText(request.nextUrl.toString(), 2048),
    requestPathname: sanitizeText(request.nextUrl.pathname, 1024),
  };
}

export function fireAndForgetDbWrite(taskName: string, task: () => Promise<void>) {
  void Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(`[app-db] ${taskName} failed`, error);
    });
}

export async function upsertTrackedUser(args: {
  tracking: TrackingContext;
  clientContext: ClientContext;
}): Promise<string> {
  const { tracking, clientContext } = args;
  const now = new Date();
  const usageSec = clientContext.usageSec;
  const language = clientContext.language ?? tracking.requestLocale;
  const fullUrl = clientContext.fullUrl ?? tracking.requestFullUrl;
  const pathname = clientContext.pathname ?? tracking.requestPathname;
  const latestUserAgent = tracking.userAgent;

  const user = await prisma.user.upsert({
    where: { externalUserId: tracking.externalUserId },
    create: {
      externalUserId: tracking.externalUserId,
      latestIpAddress: tracking.ipAddress ?? undefined,
      latestUserAgent: latestUserAgent ?? undefined,
      language: language ?? undefined,
      pageLanguage: clientContext.pageLanguage ?? undefined,
      referrer: clientContext.referrer ?? undefined,
      fullUrl: fullUrl ?? undefined,
      queryParams: clientContext.queryParams ?? undefined,
      screenWidth: clientContext.screenWidth ?? undefined,
      screenHeight: clientContext.screenHeight ?? undefined,
      timezone: clientContext.timezone ?? undefined,
      platform: clientContext.platform ?? undefined,
      pathname: pathname ?? undefined,
      totalUsageSec: usageSec ?? 0,
      firstSeenAt: now,
      lastSeenAt: now,
    },
    update: {
      latestIpAddress: tracking.ipAddress ?? undefined,
      latestUserAgent: latestUserAgent ?? undefined,
      language: language ?? undefined,
      pageLanguage: clientContext.pageLanguage ?? undefined,
      referrer: clientContext.referrer ?? undefined,
      fullUrl: fullUrl ?? undefined,
      queryParams: clientContext.queryParams ?? undefined,
      screenWidth: clientContext.screenWidth ?? undefined,
      screenHeight: clientContext.screenHeight ?? undefined,
      timezone: clientContext.timezone ?? undefined,
      platform: clientContext.platform ?? undefined,
      pathname: pathname ?? undefined,
      lastSeenAt: now,
    },
    select: {
      id: true,
      totalUsageSec: true,
    },
  });

  if (usageSec !== null && usageSec > user.totalUsageSec) {
    await prisma.user.update({
      where: { id: user.id },
      data: { totalUsageSec: usageSec },
    });
  }

  return user.id;
}

export async function createTrackedEventLog(args: {
  userId: string;
  tracking: TrackingContext;
  clientContext: ClientContext;
  eventType: string;
  messageId?: string | null;
  sessionKey?: string | null;
  usageSec?: number | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const { userId, tracking, clientContext } = args;
  const usageSec = args.usageSec ?? clientContext.usageSec;

  await prisma.appEventLog.create({
    data: {
      userId,
      messageId: args.messageId ?? undefined,
      sessionKey: args.sessionKey ?? tracking.sessionKey,
      eventType: args.eventType,
      ipAddress: tracking.ipAddress ?? undefined,
      userAgent: tracking.userAgent ?? undefined,
      platform: clientContext.platform ?? undefined,
      appVersion: clientContext.appVersion ?? undefined,
      locale: clientContext.pageLanguage ?? clientContext.language ?? tracking.requestLocale ?? undefined,
      fullUrl: clientContext.fullUrl ?? tracking.requestFullUrl ?? undefined,
      pathname: clientContext.pathname ?? tracking.requestPathname ?? undefined,
      usageSec: usageSec ?? undefined,
      metadata: args.metadata ?? undefined,
    },
  });
}
