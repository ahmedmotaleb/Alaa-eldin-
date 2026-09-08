// أداة ترحيل قاعدة البيانات — تُشغَّل يدوياً/كخطوة نشر صريحة (npm run db:migrate)،
// وليست جزءاً من دورة إقلاع تطبيق الـ Express نفسه. راجع server/migrations/README.md
// لتفاصيل التصميم والسبب في هذا الفصل.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

function listMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return []
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => a.localeCompare(b, 'en'))
}

function versionOf(filename: string): string {
  const match = filename.match(/^(\d+)_/)
  return match ? match[1] : filename
}

export async function getAppliedVersions(): Promise<Set<string>> {
  await ensureMigrationsTable()
  const { rows } = await pool.query<{ version: string }>('SELECT version FROM schema_migrations')
  return new Set(rows.map(r => r.version))
}

export function getMigrationFiles() {
  return listMigrationFiles()
}

async function runMigration(filename: string) {
  const version = versionOf(filename)
  const fullPath = path.join(MIGRATIONS_DIR, filename)
  const sql = fs.readFileSync(fullPath, 'utf8')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [version, filename])
    await client.query('COMMIT')
    console.log(`✓ applied ${filename}`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(`✗ failed ${filename}`)
    throw err
  } finally {
    client.release()
  }
}

async function main() {
  await ensureMigrationsTable()
  const applied = await getAppliedVersions()
  const files = listMigrationFiles()
  const pending = files.filter(f => !applied.has(versionOf(f)))

  if (pending.length === 0) {
    console.log('schema is up to date — no pending migrations')
    return
  }

  console.log(`applying ${pending.length} pending migration(s): ${pending.join(', ')}`)
  for (const file of pending) {
    await runMigration(file)
  }
  console.log('all migrations applied successfully')
}

// شغّل main() بس لو الملف ده اتنفذ مباشرة (node dist/migrate.js) — مش لو استوردته أداة تانية
// (زي checkMigrations.ts) عشان تستخدم getAppliedVersions()/getMigrationFiles().
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  main()
    .then(() => pool.end())
    .catch(async err => {
      console.error(err)
      await pool.end()
      process.exit(1)
    })
}
