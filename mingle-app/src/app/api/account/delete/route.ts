import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const normalizedUserId = typeof session.user.id === "string"
    ? session.user.id.trim()
    : "";
  const normalizedEmail = typeof session.user.email === "string"
    ? session.user.email.trim().toLowerCase()
    : "";

  let deletedUsers = 0;

  if (normalizedUserId) {
    try {
      await prisma.user.delete({
        where: {
          id: normalizedUserId,
        },
      });
      deletedUsers = 1;
    } catch (error: unknown) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025")) {
        throw error;
      }
    }
  }

  if (deletedUsers === 0 && normalizedEmail) {
    const result = await prisma.user.deleteMany({
      where: { email: normalizedEmail },
    });
    deletedUsers = result.count;
  }

  return NextResponse.json({ ok: true, deletedUsers });
}
