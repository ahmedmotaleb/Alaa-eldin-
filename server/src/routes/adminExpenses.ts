import { Router } from 'express'
import { pool } from '../db.js'
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
  SELECT id, category, amount, note, expense_date as "expenseDate", created_at as "createdAt"
  FROM expenses
`

adminExpensesRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<ExpenseRow>(`${SELECT_EXPENSE} ORDER BY expense_date DESC, id DESC`)
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

adminExpensesRouter.post('/', async (req, res) => {
  const b = req.body ?? {}
  if (!validate(b)) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const { rows: insertedRows } = await pool.query<{ id: number }>(
    `INSERT INTO expenses (category, amount, note, expense_date, created_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [b.category.trim(), b.amount, typeof b.note === 'string' ? b.note.trim() : '', b.expenseDate, new Date().toISOString()]
  )

  const { rows } = await pool.query<ExpenseRow>(`${SELECT_EXPENSE} WHERE id = $1`, [insertedRows[0].id])
  res.status(201).json({ expense: rows[0] })
})

adminExpensesRouter.patch('/:id', async (req, res) => {
  const { rows: existingRows } = await pool.query<ExpenseRow>(`${SELECT_EXPENSE} WHERE id = $1`, [req.params.id])
  const existing = existingRows[0]
  if (!existing) {
    res.status(404).json({ error: 'expense_not_found' })
    return
  }

  const b = { ...existing, ...(req.body ?? {}) } as Record<string, unknown>
  if (!validate(b)) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  await pool.query(
    'UPDATE expenses SET category = $1, amount = $2, note = $3, expense_date = $4 WHERE id = $5',
    [b.category, b.amount, b.note ?? '', b.expenseDate, req.params.id]
  )

  const { rows } = await pool.query<ExpenseRow>(`${SELECT_EXPENSE} WHERE id = $1`, [req.params.id])
  res.json({ expense: rows[0] })
})

adminExpensesRouter.delete('/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM expenses WHERE id = $1', [req.params.id])
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'expense_not_found' })
    return
  }
  res.status(204).end()
})
