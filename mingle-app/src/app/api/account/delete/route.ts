import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const normalizedUserId = typeof session.user.id === "string"
    ? session.user.id.trim()
    : "";
  const normalizedEmail = typeof session.user.email === "string"
    ? session.user.email.trim().toLowerCase()
    : "";

  if (normalizedUserId) {
    try {
      await prisma.user.delete({
        where: {
          id: normalizedUserId,
        },
      });
      return NextResponse.json({ ok: true, deletedUsers: 1 });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        return NextResponse.json({ ok: true, deletedUsers: 0 });
      }
      throw error;
    }
  }

  let deletedUsers = 0;
  if (normalizedEmail) {
    const result = await prisma.user.deleteMany({
      where: { email: normalizedEmail },
    });
    deletedUsers = result.count;
  }

  return NextResponse.json({ ok: true, deletedUsers });
}
