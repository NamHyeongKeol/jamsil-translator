-- CreateSchema
CREATE SCHEMA IF NOT EXISTS app;

-- CreateTable
CREATE TABLE "app"."app_users" (
    "id" TEXT NOT NULL,
    "external_user_id" TEXT,
    "email" TEXT,
    "latest_ip_address" TEXT,
    "total_usage_sec" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "app_users_external_user_id_key" UNIQUE ("external_user_id"),
    CONSTRAINT "app_users_total_usage_sec_check" CHECK ("total_usage_sec" >= 0)
);

-- CreateTable
CREATE TABLE "app"."app_messages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "session_key" TEXT,
    "client_message_id" TEXT,
    "source_language" TEXT NOT NULL,
    "translation_prompt_tokens" INTEGER,
    "translation_completion_tokens" INTEGER,
    "translation_total_tokens" INTEGER,
    "tts_input_tokens" INTEGER,
    "tts_output_tokens" INTEGER,
    "tts_total_tokens" INTEGER,
    "stt_duration_ms" INTEGER,
    "total_duration_ms" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "app_messages_session_client_message_uidx" UNIQUE ("session_key", "client_message_id"),
    CONSTRAINT "app_messages_translation_prompt_tokens_check" CHECK ("translation_prompt_tokens" IS NULL OR "translation_prompt_tokens" >= 0),
    CONSTRAINT "app_messages_translation_completion_tokens_check" CHECK ("translation_completion_tokens" IS NULL OR "translation_completion_tokens" >= 0),
    CONSTRAINT "app_messages_translation_total_tokens_check" CHECK ("translation_total_tokens" IS NULL OR "translation_total_tokens" >= 0),
    CONSTRAINT "app_messages_tts_input_tokens_check" CHECK ("tts_input_tokens" IS NULL OR "tts_input_tokens" >= 0),
    CONSTRAINT "app_messages_tts_output_tokens_check" CHECK ("tts_output_tokens" IS NULL OR "tts_output_tokens" >= 0),
    CONSTRAINT "app_messages_tts_total_tokens_check" CHECK ("tts_total_tokens" IS NULL OR "tts_total_tokens" >= 0),
    CONSTRAINT "app_messages_stt_duration_ms_check" CHECK ("stt_duration_ms" IS NULL OR "stt_duration_ms" >= 0),
    CONSTRAINT "app_messages_total_duration_ms_check" CHECK ("total_duration_ms" IS NULL OR "total_duration_ms" >= 0)
);

-- CreateTable
CREATE TABLE "app"."app_message_contents" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_message_contents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "app_message_contents_message_type_lang_uidx" UNIQUE ("message_id", "content_type", "language"),
    CONSTRAINT "app_message_contents_content_type_check" CHECK ("content_type" IN ('SOURCE', 'TRANSLATION_FINAL'))
);

-- CreateTable
CREATE TABLE "app"."app_event_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "message_id" TEXT,
    "session_key" TEXT,
    "event_type" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "platform" TEXT,
    "app_version" TEXT,
    "locale" TEXT,
    "full_url" TEXT,
    "pathname" TEXT,
    "usage_sec" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_event_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "app_event_logs_usage_sec_check" CHECK ("usage_sec" IS NULL OR "usage_sec" >= 0)
);

-- CreateFunction
CREATE OR REPLACE FUNCTION "app"."set_updated_at"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updated_at" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CreateIndex
CREATE INDEX "app_users_email_idx" ON "app"."app_users"("email");

-- CreateIndex
CREATE INDEX "app_users_last_seen_at_idx" ON "app"."app_users"("last_seen_at");

-- CreateIndex
CREATE INDEX "app_messages_user_created_at_idx" ON "app"."app_messages"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "app_messages_session_created_at_idx" ON "app"."app_messages"("session_key", "created_at");

-- CreateIndex
CREATE INDEX "app_messages_created_at_idx" ON "app"."app_messages"("created_at");

-- CreateIndex
CREATE INDEX "app_message_contents_message_created_at_idx" ON "app"."app_message_contents"("message_id", "created_at");

-- CreateIndex
CREATE INDEX "app_message_contents_type_idx" ON "app"."app_message_contents"("content_type");

-- CreateIndex
CREATE INDEX "app_message_contents_language_idx" ON "app"."app_message_contents"("language");

-- CreateIndex
CREATE INDEX "app_event_logs_event_type_idx" ON "app"."app_event_logs"("event_type");

-- CreateIndex
CREATE INDEX "app_event_logs_created_at_idx" ON "app"."app_event_logs"("created_at");

-- CreateIndex
CREATE INDEX "app_event_logs_user_id_idx" ON "app"."app_event_logs"("user_id");

-- CreateIndex
CREATE INDEX "app_event_logs_session_key_idx" ON "app"."app_event_logs"("session_key");

-- CreateIndex
CREATE INDEX "app_event_logs_message_id_idx" ON "app"."app_event_logs"("message_id");

-- AddForeignKey
ALTER TABLE "app"."app_messages"
ADD CONSTRAINT "app_messages_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "app"."app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."app_message_contents"
ADD CONSTRAINT "app_message_contents_message_id_fkey"
FOREIGN KEY ("message_id") REFERENCES "app"."app_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."app_event_logs"
ADD CONSTRAINT "app_event_logs_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "app"."app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."app_event_logs"
ADD CONSTRAINT "app_event_logs_message_id_fkey"
FOREIGN KEY ("message_id") REFERENCES "app"."app_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTrigger
CREATE TRIGGER "set_app_users_updated_at"
BEFORE UPDATE ON "app"."app_users"
FOR EACH ROW
EXECUTE FUNCTION "app"."set_updated_at"();

-- CreateTrigger
CREATE TRIGGER "set_app_messages_updated_at"
BEFORE UPDATE ON "app"."app_messages"
FOR EACH ROW
EXECUTE FUNCTION "app"."set_updated_at"();

-- CreateTrigger
CREATE TRIGGER "set_app_message_contents_updated_at"
BEFORE UPDATE ON "app"."app_message_contents"
FOR EACH ROW
EXECUTE FUNCTION "app"."set_updated_at"();

-- CreateTrigger
CREATE TRIGGER "set_app_event_logs_updated_at"
BEFORE UPDATE ON "app"."app_event_logs"
FOR EACH ROW
EXECUTE FUNCTION "app"."set_updated_at"();
