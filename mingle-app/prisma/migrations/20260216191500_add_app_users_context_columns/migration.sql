-- AlterTable
ALTER TABLE "app"."app_users"
ADD COLUMN "latest_user_agent" TEXT,
ADD COLUMN "language" TEXT,
ADD COLUMN "page_language" TEXT,
ADD COLUMN "referrer" TEXT,
ADD COLUMN "full_url" TEXT,
ADD COLUMN "query_params" TEXT,
ADD COLUMN "screen_width" INTEGER,
ADD COLUMN "screen_height" INTEGER,
ADD COLUMN "timezone" TEXT,
ADD COLUMN "platform" TEXT,
ADD COLUMN "pathname" TEXT,
ADD CONSTRAINT "app_users_screen_width_check" CHECK ("screen_width" IS NULL OR "screen_width" >= 0),
ADD CONSTRAINT "app_users_screen_height_check" CHECK ("screen_height" IS NULL OR "screen_height" >= 0);
