import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "@/lib/auth-options";
import { normalizeAppLocale } from "@/lib/app-locale";
import { prisma } from "@/lib/prisma";

// GET /api/profile — 현재 유저 프로필 조회
export async function GET() {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      image: true,
      displayName: true,
      bio: true,
      nationality: true,
      appLocale: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...user,
    appLocale: normalizeAppLocale(user.appLocale),
  });
}

// PATCH /api/profile — 프로필 수정
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { displayName?: string; bio?: string; nationality?: string; appLocale?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { displayName, bio, nationality, appLocale } = body;

  // 허용 필드만 추출하여 업데이트
  const data: Record<string, string | null> = {};
  if (displayName !== undefined) data.displayName = displayName || null;
  if (bio !== undefined) data.bio = bio || null;
  if (nationality !== undefined) data.nationality = nationality || null;
  if (appLocale !== undefined) {
    const normalizedAppLocale = normalizeAppLocale(appLocale);
    if (appLocale && !normalizedAppLocale) {
      return NextResponse.json({ error: "Invalid appLocale" }, { status: 400 });
    }
    data.appLocale = normalizedAppLocale;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: {
      id: true,
      name: true,
      image: true,
      displayName: true,
      bio: true,
      nationality: true,
      appLocale: true,
    },
  });

  return NextResponse.json({
    ...updated,
    appLocale: normalizeAppLocale(updated.appLocale),
  });
}
