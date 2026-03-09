import type { AppLocale } from "@/i18n";
import { normalizeAppLocale } from "@/lib/app-locale";
import { prisma } from "@/lib/prisma";

function normalizeUserId(rawUserId: string | null | undefined): string | null {
  if (typeof rawUserId !== "string") return null;
  const normalized = rawUserId.trim();
  return normalized || null;
}

export async function getUserPreferredLocale(rawUserId: string | null | undefined): Promise<AppLocale | null> {
  const userId = normalizeUserId(rawUserId);
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { appLocale: true },
  });

  return normalizeAppLocale(user?.appLocale);
}
