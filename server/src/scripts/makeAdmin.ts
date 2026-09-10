import { pool } from '../db.js'

const email = process.argv[2]?.toLowerCase()

if (!email) {
  console.error('Usage: npm run make-admin --prefix server -- user@example.com')
  process.exit(1)
}

const result = await pool.query("UPDATE users SET is_admin = 1, role = 'admin' WHERE email = $1", [email])

if (result.rowCount === 0) {
  console.error(`No user found with email "${email}". Register the account first via the customer app, then rerun this script.`)
  process.exit(1)
}

console.log(`"${email}" is now an admin.`)
await pool.end()
