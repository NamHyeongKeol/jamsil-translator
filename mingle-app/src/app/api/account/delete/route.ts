import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const normalizedEmail = typeof session.user.email === "string"
    ? session.user.email.trim().toLowerCase()
    : "";

  let deletedUsers = 0;
  if (normalizedEmail) {
    const result = await prisma.appUser.deleteMany({
      where: {
        email: normalizedEmail,
      },
    });
    deletedUsers = result.count;
  }

  return NextResponse.json({ ok: true, deletedUsers });
}
