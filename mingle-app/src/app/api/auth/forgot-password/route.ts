import { NextResponse } from "next/server";
import { createOpaqueToken, hashOpaqueToken, isValidEmail, normalizeEmail } from "@/lib/email-password-auth";
import { DEFAULT_LOCALE, resolveSupportedLocaleTag } from "@/i18n";
import { prisma } from "@/lib/prisma";
import { isResendConfigured, sendPasswordResetEmail } from "@/lib/resend-email";

type ForgotPasswordPayload = {
  email?: unknown;
  locale?: unknown;
};

function resolvePublicBaseUrl(): string {
  const raw = (
    process.env.NEXTAUTH_URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || "http://localhost:3000"
  ).trim();

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    // fall through
  }
  return "http://localhost:3000";
}

function resolveLocale(rawValue: unknown): string {
  if (typeof rawValue !== "string") return DEFAULT_LOCALE;
  return resolveSupportedLocaleTag(rawValue) ?? DEFAULT_LOCALE;
}

function resolveResetExpiryMinutes(): number {
  const raw = Number(process.env.EMAIL_RESET_TOKEN_TTL_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) return 30;
  return Math.min(Math.floor(raw), 120);
}

async function replaceActiveResetToken(params: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
}) {
  const { userId, tokenHash, expiresAt, now } = params;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "app"."app_users" WHERE id = ${userId} FOR UPDATE`;

    await tx.passwordResetToken.updateMany({
      where: {
        userId,
        usedAt: null,
      },
      data: {
        usedAt: now,
      },
    });

    await tx.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });
  });
}

export async function POST(request: Request) {
  if (!isResendConfigured()) {
    return NextResponse.json({ error: "email_service_not_configured" }, { status: 503 });
  }

  let payload: ForgotPasswordPayload | null = null;
  try {
    payload = await request.json() as ForgotPasswordPayload;
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const email = normalizeEmail(payload?.email);
  const locale = resolveLocale(payload?.locale);
  if (!email) {
    return NextResponse.json({ error: "missing_email" }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  // 사용자 존재 여부 노출을 막기 위해 항상 동일한 성공 응답을 반환.
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const now = new Date();
  const rawToken = createOpaqueToken(32);
  const tokenHash = hashOpaqueToken(rawToken);
  const expiresAt = new Date(now.getTime() + (resolveResetExpiryMinutes() * 60_000));
  await replaceActiveResetToken({
    userId: user.id,
    tokenHash,
    expiresAt,
    now,
  });

  const baseUrl = resolvePublicBaseUrl();
  const resetUrl = `${baseUrl}/${encodeURIComponent(locale)}/auth/reset-password?token=${encodeURIComponent(rawToken)}`;

  try {
    await sendPasswordResetEmail({
      to: email,
      resetUrl,
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[forgot-password] email_send_failed reason=${reason}`);
    return NextResponse.json({ error: "email_send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
