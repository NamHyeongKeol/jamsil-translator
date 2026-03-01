WITH ranked_active_tokens AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM "app"."app_password_reset_tokens"
  WHERE used_at IS NULL
)
UPDATE "app"."app_password_reset_tokens" AS tokens
SET
  used_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP
FROM ranked_active_tokens
WHERE
  tokens.id = ranked_active_tokens.id
  AND ranked_active_tokens.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "app_password_reset_tokens_user_active_uidx"
ON "app"."app_password_reset_tokens" ("user_id")
WHERE "used_at" IS NULL;
