import { NextResponse } from "next/server";
import { hashOpaqueToken, hashPassword, validatePassword } from "@/lib/email-password-auth";
import { prisma } from "@/lib/prisma";

type ResetPasswordPayload = {
  token?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  let payload: ResetPasswordPayload | null = null;
  try {
    payload = await request.json() as ResetPasswordPayload;
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const token = typeof payload?.token === "string" ? payload.token.trim() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";

  if (!token || !password) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!validatePassword(password)) {
    return NextResponse.json({ error: "invalid_password" }, { status: 400 });
  }

  const tokenHash = hashOpaqueToken(token);
  const now = new Date();
  const passwordResetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      usedAt: true,
      expiresAt: true,
    },
  });

  if (!passwordResetToken) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }
  if (passwordResetToken.usedAt) {
    return NextResponse.json({ error: "token_already_used" }, { status: 400 });
  }
  if (passwordResetToken.expiresAt.getTime() <= now.getTime()) {
    return NextResponse.json({ error: "token_expired" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: passwordResetToken.userId },
      data: {
        passwordHash: hashPassword(password),
        lastSeenAt: now,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: passwordResetToken.id },
      data: {
        usedAt: now,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}

