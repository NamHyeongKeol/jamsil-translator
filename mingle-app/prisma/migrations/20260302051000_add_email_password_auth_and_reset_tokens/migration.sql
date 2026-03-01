ALTER TABLE "app"."app_users"
ADD COLUMN IF NOT EXISTS "password_hash" TEXT;

CREATE TABLE IF NOT EXISTS "app"."app_password_reset_tokens" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "used_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "app_password_reset_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "app_password_reset_tokens_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "app_password_reset_tokens_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "app"."app_users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "app_password_reset_tokens_user_expires_idx"
ON "app"."app_password_reset_tokens"("user_id", "expires_at");

CREATE INDEX IF NOT EXISTS "app_password_reset_tokens_expires_at_idx"
ON "app"."app_password_reset_tokens"("expires_at");

