-- Add platform dimension so version catalog/policy history can be managed per client platform.
ALTER TABLE "app"."app_client_versions"
ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'ios';

ALTER TABLE "app"."app_client_versions"
ADD CONSTRAINT "app_client_versions_platform_check"
CHECK ("platform" ~ '^[a-z][a-z0-9_-]{1,31}$');

ALTER TABLE "app"."app_client_versions"
DROP CONSTRAINT IF EXISTS "app_client_versions_version_key";

ALTER TABLE "app"."app_client_versions"
ADD CONSTRAINT "app_client_versions_platform_version_key"
UNIQUE ("platform", "version");

DROP INDEX IF EXISTS "app"."app_client_versions_semver_idx";

CREATE INDEX "app_client_versions_platform_semver_idx"
ON "app"."app_client_versions"("platform", "major", "minor", "patch");

ALTER TABLE "app"."app_client_version_policies"
ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'ios';

ALTER TABLE "app"."app_client_version_policies"
ADD CONSTRAINT "app_client_version_policies_platform_check"
CHECK ("platform" ~ '^[a-z][a-z0-9_-]{1,31}$');

DROP INDEX IF EXISTS "app"."app_client_version_policies_effective_from_created_at_idx";

CREATE INDEX "app_client_version_policies_platform_effective_from_created_at_idx"
ON "app"."app_client_version_policies"("platform", "effective_from", "created_at");
