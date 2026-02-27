ALTER TABLE "app"."app_users"
ADD COLUMN IF NOT EXISTS "name" TEXT,
ADD COLUMN IF NOT EXISTS "image" TEXT,
ADD COLUMN IF NOT EXISTS "email_verified" TIMESTAMPTZ;

UPDATE "app"."app_users"
SET "email" = LOWER(BTRIM("email"))
WHERE "email" IS NOT NULL
  AND "email" <> LOWER(BTRIM("email"));

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY LOWER("email")
      ORDER BY "last_seen_at" DESC NULLS LAST, "created_at" DESC NULLS LAST, "id" DESC
    ) AS row_num
  FROM "app"."app_users"
  WHERE "email" IS NOT NULL
    AND BTRIM("email") <> ''
),
duplicates AS (
  SELECT "id"
  FROM ranked
  WHERE row_num > 1
)
UPDATE "app"."app_users" AS app_users
SET "email" = NULL
FROM duplicates
WHERE app_users."id" = duplicates."id";

DROP INDEX IF EXISTS "app"."app_users_email_idx";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_users_email_key'
      AND connamespace = 'app'::regnamespace
  ) THEN
    ALTER TABLE "app"."app_users"
    ADD CONSTRAINT "app_users_email_key" UNIQUE ("email");
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "app"."auth_accounts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_account_id" TEXT NOT NULL,
  "refresh_token" TEXT,
  "access_token" TEXT,
  "expires_at" INTEGER,
  "token_type" TEXT,
  "scope" TEXT,
  "id_token" TEXT,
  "session_state" TEXT,
  CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_accounts_provider_provider_account_id_key" UNIQUE ("provider", "provider_account_id"),
  CONSTRAINT "auth_accounts_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "app"."app_users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "auth_accounts_user_id_idx"
ON "app"."auth_accounts"("user_id");

CREATE TABLE IF NOT EXISTS "app"."auth_sessions" (
  "id" TEXT NOT NULL,
  "session_token" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "expires" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_sessions_session_token_key" UNIQUE ("session_token"),
  CONSTRAINT "auth_sessions_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "app"."app_users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "auth_sessions_user_id_idx"
ON "app"."auth_sessions"("user_id");

CREATE TABLE IF NOT EXISTS "app"."auth_verification_tokens" (
  "identifier" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expires" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "auth_verification_tokens_identifier_token_key" UNIQUE ("identifier", "token"),
  CONSTRAINT "auth_verification_tokens_token_key" UNIQUE ("token")
);
