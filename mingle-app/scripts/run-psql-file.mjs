#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'

const [, , sqlFileArg] = process.argv

if (!sqlFileArg) {
  console.error('Usage: node scripts/run-psql-file.mjs <sql-file-path>')
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

let psqlDatabaseUrl = databaseUrl
try {
  const parsed = new URL(databaseUrl)
  parsed.searchParams.delete('schema')
  psqlDatabaseUrl = parsed.toString()
} catch {
  // Fallback for non-URL DSN formats: pass through as-is.
}

const sqlFilePath = path.resolve(process.cwd(), sqlFileArg)
const result = spawnSync(
  'psql',
  [psqlDatabaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlFilePath],
  {
    stdio: 'inherit',
    env: process.env,
  },
)

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
