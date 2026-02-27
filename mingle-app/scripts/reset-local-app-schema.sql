-- Reset mingle-app local schema and re-apply Prisma SQL migrations.
-- Usage:
--   psql -v ON_ERROR_STOP=1 -d postgres -f scripts/reset-local-app-schema.sql

DROP SCHEMA IF EXISTS app CASCADE;

\ir ../prisma/migrations/20260216173000_init_app_schema/migration.sql
\ir ../prisma/migrations/20260216191500_add_app_users_context_columns/migration.sql
\ir ../prisma/migrations/20260227211000_add_client_version_policy_history/migration.sql
