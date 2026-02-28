#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

function log(message) {
  process.stdout.write(`[db-itest] ${message}\n`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    ...options,
  })
  if (result.status !== 0) {
    const rendered = [command, ...args].join(' ')
    throw new Error(`command failed (${result.status}): ${rendered}`)
  }
}

function runBestEffort(command, args, options = {}) {
  spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    ...options,
  })
}

function resolveDatabaseUrls() {
  const sourceDatabaseUrl = process.env.DATABASE_URL
  if (!sourceDatabaseUrl) {
    throw new Error('DATABASE_URL is required. Use .env.local or export DATABASE_URL first.')
  }

  const parsed = new URL(sourceDatabaseUrl)
  const originalSchema = parsed.searchParams.get('schema')
  const schema = originalSchema && originalSchema.trim() ? originalSchema.trim() : 'app'

  const base = new URL(parsed.toString())
  base.searchParams.delete('schema')

  const admin = new URL(base.toString())
  admin.pathname = '/postgres'

  const dbName = `mingle_app_test_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`
  const test = new URL(base.toString())
  test.pathname = `/${dbName}`
  test.searchParams.set('schema', schema)

  return {
    adminDbUrl: admin.toString(),
    testDbUrl: test.toString(),
    testDbName: dbName,
  }
}

function listMigrationSqlFiles() {
  const migrationsDir = path.join(rootDir, 'prisma', 'migrations')
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(migrationsDir, entry.name, 'migration.sql'))
    .sort((a, b) => a.localeCompare(b))
}

const { adminDbUrl, testDbUrl, testDbName } = resolveDatabaseUrls()
const migrationSqlFiles = listMigrationSqlFiles()
const seedSqlPath = path.join(rootDir, 'test-fixtures', 'db', 'version-policy.seed.sql')

log(`creating disposable test db: ${testDbName}`)
run('psql', [adminDbUrl, '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${testDbName}";`])

try {
  for (const sqlFile of migrationSqlFiles) {
    log(`applying migration: ${path.relative(rootDir, sqlFile)}`)
    run('psql', [testDbUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlFile])
  }

  log(`applying seed fixture: ${path.relative(rootDir, seedSqlPath)}`)
  run('psql', [testDbUrl, '-v', 'ON_ERROR_STOP=1', '-f', seedSqlPath])

  log('running DB integration tests')
  run(
    'pnpm',
    ['vitest', 'run', 'src/integration/db/version-policy.db.test.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: testDbUrl,
        MINGLE_DB_INTEGRATION: '1',
      },
    },
  )
} finally {
  log(`dropping disposable test db: ${testDbName}`)
  runBestEffort('psql', [
    adminDbUrl,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${testDbName}' AND pid <> pg_backend_pid();`,
  ])
  runBestEffort('psql', [
    adminDbUrl,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `DROP DATABASE IF EXISTS "${testDbName}";`,
  ])
}

log('done')
