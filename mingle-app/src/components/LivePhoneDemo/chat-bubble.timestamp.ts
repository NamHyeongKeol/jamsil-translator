function normalizeLocale(locale: string): string {
  const trimmed = locale.trim();
  return trimmed || "en";
}

function formatRelativeSeconds(secondsAgo: number, locale: string): string {
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      -secondsAgo,
      "second",
    );
  } catch {
    return `${secondsAgo}s ago`;
  }
}

function formatDate(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", options).format(date);
  }
}

export function formatChatBubbleTimestamp(
  createdAtMs: number | undefined,
  locale: string,
): string {
  if (!createdAtMs) return "";

  const normalizedLocale = normalizeLocale(locale);
  const now = Date.now();
  const created = new Date(createdAtMs);
  const current = new Date(now);

  if (Number.isNaN(created.getTime())) return "";

  const sameYear = created.getFullYear() === current.getFullYear();
  const sameMonth = sameYear && created.getMonth() === current.getMonth();
  const sameDay = sameMonth && created.getDate() === current.getDate();
  const sameMinute =
    sameDay
    && created.getHours() === current.getHours()
    && created.getMinutes() === current.getMinutes();

  if (sameMinute) {
    const secondsAgo = Math.max(0, Math.floor((now - createdAtMs) / 1000));
    return formatRelativeSeconds(secondsAgo, normalizedLocale);
  }

  if (sameDay) {
    return formatDate(created, normalizedLocale, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  if (sameYear) {
    return formatDate(created, normalizedLocale, {
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return formatDate(created, normalizedLocale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
