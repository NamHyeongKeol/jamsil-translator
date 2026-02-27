-- CreateTable
CREATE TABLE "app"."app_client_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "major" INTEGER NOT NULL,
    "minor" INTEGER NOT NULL,
    "patch" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_client_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "app_client_versions_version_key" UNIQUE ("version"),
    CONSTRAINT "app_client_versions_major_check" CHECK ("major" >= 0),
    CONSTRAINT "app_client_versions_minor_check" CHECK ("minor" >= 0),
    CONSTRAINT "app_client_versions_patch_check" CHECK ("patch" >= 0)
);

-- CreateTable
CREATE TABLE "app"."app_client_version_policies" (
    "id" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "min_supported_version" TEXT NOT NULL,
    "recommended_below_version" TEXT,
    "latest_version" TEXT,
    "update_url" TEXT,
    "note" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_client_version_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "app_client_version_policies_min_supported_version_semver_check" CHECK ("min_supported_version" ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
    CONSTRAINT "app_client_version_policies_recommended_below_version_semver_check" CHECK ("recommended_below_version" IS NULL OR "recommended_below_version" ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
    CONSTRAINT "app_client_version_policies_latest_version_semver_check" CHECK ("latest_version" IS NULL OR "latest_version" ~ '^[0-9]+\.[0-9]+\.[0-9]+$')
);

-- CreateIndex
CREATE INDEX "app_client_versions_semver_idx" ON "app"."app_client_versions"("major", "minor", "patch");

-- CreateIndex
CREATE INDEX "app_client_versions_created_at_idx" ON "app"."app_client_versions"("created_at");

-- CreateIndex
CREATE INDEX "app_client_version_policies_effective_from_created_at_idx" ON "app"."app_client_version_policies"("effective_from", "created_at");

-- CreateIndex
CREATE INDEX "app_client_version_policies_created_by_user_id_idx" ON "app"."app_client_version_policies"("created_by_user_id");

-- CreateIndex
CREATE INDEX "app_client_version_policies_created_at_idx" ON "app"."app_client_version_policies"("created_at");

-- AddForeignKey
ALTER TABLE "app"."app_client_version_policies"
ADD CONSTRAINT "app_client_version_policies_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "app"."app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTrigger
CREATE TRIGGER "set_app_client_version_policies_updated_at"
BEFORE UPDATE ON "app"."app_client_version_policies"
FOR EACH ROW
EXECUTE FUNCTION "app"."set_updated_at"();

-- Seed an initial active policy so the API has a deterministic DB baseline after migration.
INSERT INTO "app"."app_client_version_policies" (
    "id",
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
    'seed_20260227211000_initial_policy',
    CURRENT_TIMESTAMP,
    '1.0.0',
    NULL,
    '1.0.0',
    NULL,
    'initial seeded policy',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
