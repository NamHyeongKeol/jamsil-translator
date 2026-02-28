-- Remove fixture rows inserted by test-fixtures/db/version-policy.seed.sql.

DELETE FROM "app"."app_client_version_policies"
WHERE "id" LIKE 'fixture_cp_%'
   OR ("note" IS NOT NULL AND "note" LIKE '[test-fixture]%');

DELETE FROM "app"."app_client_versions"
WHERE "id" LIKE 'fixture_cv_%';
