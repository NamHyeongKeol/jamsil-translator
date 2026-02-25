const SCHEMA_PARAM_KEY = "schema";

export function ensureDatabaseSchemaParam(
  databaseUrl: string | undefined,
  defaultSchema: string
): string | undefined {
  if (!databaseUrl) return undefined;

  const trimmedSchema = defaultSchema.trim();
  if (!trimmedSchema) return databaseUrl;

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    // Keep original value when URL parsing fails and let Prisma surface the real error.
    return databaseUrl;
  }

  const currentSchema = parsed.searchParams.get(SCHEMA_PARAM_KEY)?.trim();
  if (!currentSchema) {
    parsed.searchParams.set(SCHEMA_PARAM_KEY, trimmedSchema);
  }

  return parsed.toString();
}
