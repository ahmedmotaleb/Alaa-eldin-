import { db } from '../db.js'

const email = process.argv[2]?.toLowerCase()

if (!email) {
  console.error('Usage: npm run make-admin --prefix server -- user@example.com')
  process.exit(1)
}

const result = db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email)

if (result.changes === 0) {
  console.error(`No user found with email "${email}". Register the account first via the customer app, then rerun this script.`)
  process.exit(1)
}

console.log(`"${email}" is now an admin.`)
