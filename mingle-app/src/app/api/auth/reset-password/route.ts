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
  const passwordHash = hashPassword(password);
  const result = await prisma.$transaction(async (tx) => {
    const passwordResetToken = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        usedAt: true,
        expiresAt: true,
      },
    });

    if (!passwordResetToken) {
      return { error: "invalid_token" } as const;
    }
    if (passwordResetToken.usedAt) {
      return { error: "token_already_used" } as const;
    }
    if (passwordResetToken.expiresAt.getTime() <= now.getTime()) {
      return { error: "token_expired" } as const;
    }

    // usedAt NULL 조건으로 토큰을 선점(claim)해 동시 요청 중 하나만 성공시키기.
    const claimResult = await tx.passwordResetToken.updateMany({
      where: {
        id: passwordResetToken.id,
        usedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      data: {
        usedAt: now,
      },
    });

    if (claimResult.count !== 1) {
      return { error: "token_already_used" } as const;
    }

    await tx.passwordResetToken.updateMany({
      where: {
        userId: passwordResetToken.userId,
        usedAt: null,
      },
      data: {
        usedAt: now,
      },
    });

    await tx.user.update({
      where: { id: passwordResetToken.userId },
      data: {
        passwordHash,
        lastSeenAt: now,
      },
    });

    return { ok: true } as const;
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
