import { getAppliedVersions, getMigrationFiles } from './migrate.js'
import { pool } from './db.js'

function versionOf(filename: string): string {
  return filename.match(/^(\d+)_/)?.[1] ?? filename
}

async function main() {
  const applied = await getAppliedVersions()
  const files = getMigrationFiles()

  console.log('migration status:')
  for (const file of files) {
    const isApplied = applied.has(versionOf(file))
    console.log(`  [${isApplied ? 'x' : ' '}] ${file}`)
  }

  const pending = files.filter(f => !applied.has(versionOf(f)))
  console.log(pending.length === 0 ? '\nup to date' : `\n${pending.length} pending migration(s)`)
}

main()
  .then(() => pool.end())
  .catch(async err => {
    console.error(err)
    await pool.end()
    process.exit(1)
  })
