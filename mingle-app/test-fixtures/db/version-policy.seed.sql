-- Seed fixture rows for client version policy local/integration tests.
-- Safe to re-run: fixture IDs are stable and use ON CONFLICT upsert patterns.

INSERT INTO "app"."app_client_versions" (
  "id",
  "platform",
  "version",
  "major",
  "minor",
  "patch",
  "created_at"
)
VALUES
  ('fixture_cv_ios_1_0_0', 'ios', '1.0.0', 1, 0, 0, NOW()),
  ('fixture_cv_ios_1_2_0', 'ios', '1.2.0', 1, 2, 0, NOW()),
  ('fixture_cv_ios_1_4_0', 'ios', '1.4.0', 1, 4, 0, NOW()),
  ('fixture_cv_android_2_0_0', 'android', '2.0.0', 2, 0, 0, NOW()),
  ('fixture_cv_android_2_1_0', 'android', '2.1.0', 2, 1, 0, NOW())
ON CONFLICT ("id") DO UPDATE SET
  "platform" = EXCLUDED."platform",
  "version" = EXCLUDED."version",
  "major" = EXCLUDED."major",
  "minor" = EXCLUDED."minor",
  "patch" = EXCLUDED."patch";

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
VALUES
  (
    'fixture_cp_ios_current',
    'ios',
    NOW() - INTERVAL '1 day',
    '1.1.0',
    '1.3.0',
    '1.4.0',
    'https://apps.apple.com/app/id1234567890',
    '[test-fixture] ios current policy',
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '1 day'
  ),
  (
    'fixture_cp_android_current',
    'android',
    NOW() - INTERVAL '1 day',
    '2.0.0',
    '2.1.0',
    '2.2.0',
    'https://play.google.com/store/apps/details?id=com.minglelabs.mingle',
    '[test-fixture] android current policy',
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '1 day'
  )
ON CONFLICT ("id") DO UPDATE SET
  "platform" = EXCLUDED."platform",
  "effective_from" = EXCLUDED."effective_from",
  "min_supported_version" = EXCLUDED."min_supported_version",
  "recommended_below_version" = EXCLUDED."recommended_below_version",
  "latest_version" = EXCLUDED."latest_version",
  "update_url" = EXCLUDED."update_url",
  "note" = EXCLUDED."note",
  "updated_at" = NOW();
