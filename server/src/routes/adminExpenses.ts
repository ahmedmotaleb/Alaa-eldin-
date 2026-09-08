import { Router } from 'express'
import { db } from '../db.js'
import { requireAdmin } from '../auth.js'

export const adminExpensesRouter = Router()
adminExpensesRouter.use(requireAdmin)

interface ExpenseRow {
  id: number
  category: string
  amount: number
  note: string
  expenseDate: string
  createdAt: string
}

const SELECT_EXPENSE = `
  SELECT id, category, amount, note, expense_date as expenseDate, created_at as createdAt
  FROM expenses
`

adminExpensesRouter.get('/', (_req, res) => {
  const rows = db.prepare(`${SELECT_EXPENSE} ORDER BY expense_date DESC, id DESC`).all() as ExpenseRow[]
  res.json({ expenses: rows })
})

function validate(b: Record<string, unknown>) {
  return (
    typeof b.category === 'string' && !!b.category.trim() &&
    typeof b.amount === 'number' && b.amount > 0 &&
    typeof b.expenseDate === 'string' && !!b.expenseDate.trim() &&
    (b.note === undefined || typeof b.note === 'string')
  )
}

adminExpensesRouter.post('/', (req, res) => {
  const b = req.body ?? {}
  if (!validate(b)) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const insert = db.prepare(`
    INSERT INTO expenses (category, amount, note, expense_date)
    VALUES (?, ?, ?, ?)
  `)
  const result = insert.run(b.category.trim(), b.amount, typeof b.note === 'string' ? b.note.trim() : '', b.expenseDate)

  const row = db.prepare(`${SELECT_EXPENSE} WHERE id = ?`).get(result.lastInsertRowid) as ExpenseRow
  res.status(201).json({ expense: row })
})

adminExpensesRouter.patch('/:id', (req, res) => {
  const existing = db.prepare(`${SELECT_EXPENSE} WHERE id = ?`).get(req.params.id) as ExpenseRow | undefined
  if (!existing) {
    res.status(404).json({ error: 'expense_not_found' })
    return
  }

  const b = { ...existing, ...(req.body ?? {}) } as Record<string, unknown>
  if (!validate(b)) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  db.prepare(`
    UPDATE expenses SET category = ?, amount = ?, note = ?, expense_date = ?
    WHERE id = ?
  `).run(b.category, b.amount, b.note ?? '', b.expenseDate, req.params.id)

  const row = db.prepare(`${SELECT_EXPENSE} WHERE id = ?`).get(req.params.id) as ExpenseRow
  res.json({ expense: row })
})

adminExpensesRouter.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id)
  if (result.changes === 0) {
    res.status(404).json({ error: 'expense_not_found' })
    return
  }
  res.status(204).end()
})
