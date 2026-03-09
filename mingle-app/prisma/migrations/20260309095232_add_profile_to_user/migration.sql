-- 이전 마이그레이션에서 변경된 updated_at DEFAULT 제거 (Prisma 관리)
-- AlterTable
ALTER TABLE "app_client_version_policies" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "app_event_logs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "app_message_contents" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "app_messages" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "app_password_reset_tokens" ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "used_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "app_users" ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "email_verified" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "auth_sessions" ALTER COLUMN "expires" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "auth_verification_tokens" ALTER COLUMN "expires" SET DATA TYPE TIMESTAMP(3);

-- 마이페이지 프로필 필드를 app_users 테이블에 직접 추가
ALTER TABLE "app_users" ADD COLUMN "display_name" TEXT,
ADD COLUMN "bio" TEXT,
ADD COLUMN "nationality" TEXT,
ADD COLUMN "app_locale" TEXT;
