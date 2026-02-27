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

CREATE INDEX "app_client_version_policies_platform_effective_idx"
ON "app"."app_client_version_policies"("platform", "effective_from", "created_at");

-- Seed an initial active Android policy so Android clients have a deterministic DB baseline
-- without falling back to the iOS policy row added in the previous migration.
INSERT INTO "app"."app_client_version_policies" (
    "id",
    "platform",
    "effective_from",
    "min_supported_version",
    "recommended_below_version",
    "latest_version",
    "update_url",
    "note",
    "created_at",
    "updated_at"
)
VALUES (
    'seed_20260227232000_android_initial_policy',
    'android',
    CURRENT_TIMESTAMP,
    '1.0.0',
    NULL,
    '1.0.0',
    NULL,
    'initial seeded android policy',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
