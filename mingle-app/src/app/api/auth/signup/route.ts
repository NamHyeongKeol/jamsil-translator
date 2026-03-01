import { NextResponse } from "next/server";
import { hashPassword, isValidEmail, normalizeEmail, validatePassword } from "@/lib/email-password-auth";
import { prisma } from "@/lib/prisma";

type SignupPayload = {
  email?: unknown;
  name?: unknown;
  password?: unknown;
};

function normalizeName(rawValue: unknown): string {
  if (typeof rawValue !== "string") return "";
  const normalized = rawValue.trim();
  return normalized.slice(0, 128);
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown };
  return candidate.code === "P2002";
}

export async function POST(request: Request) {
  let payload: SignupPayload | null = null;
  try {
    payload = await request.json() as SignupPayload;
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const email = normalizeEmail(payload?.email);
  const name = normalizeName(payload?.name);
  const password = typeof payload?.password === "string" ? payload.password : "";

  if (!email || !name || !password) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (!validatePassword(password)) {
    return NextResponse.json({ error: "invalid_password" }, { status: 400 });
  }

  const passwordHash = hashPassword(password);
  const now = new Date();
  const existing = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
    },
  });

  if (existing) {
    // 이메일 소유 검증이 없는 회원가입 단계에서 기존 이메일 계정을 덮어쓰지 않도록 차단.
    return NextResponse.json({ error: "email_already_registered" }, { status: 409 });
  }

  try {
    await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
  } catch (error: unknown) {
    if (isPrismaUniqueConstraintError(error)) {
      return NextResponse.json({ error: "email_already_registered" }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ ok: true, created: true }, { status: 201 });
}
