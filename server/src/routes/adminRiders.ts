import { Router } from 'express'
import crypto from 'node:crypto'
import { db } from '../db.js'
import { requireAdmin } from '../auth.js'

export const adminRidersRouter = Router()
adminRidersRouter.use(requireAdmin)

interface RiderRow {
  id: string
  name: string
  phone: string
  active: number
  createdAt: string
}

const SELECT_RIDER = `
  SELECT id, name, phone, active, created_at as createdAt
  FROM riders
`

function serialize(row: RiderRow) {
  return { ...row, active: !!row.active }
}

adminRidersRouter.get('/', (_req, res) => {
  const rows = db.prepare(`${SELECT_RIDER} ORDER BY created_at DESC`).all() as RiderRow[]
  res.json({ riders: rows.map(serialize) })
})

adminRidersRouter.post('/', (req, res) => {
  const { name, phone } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const id = crypto.randomUUID()
  db.prepare('INSERT INTO riders (id, name, phone, active) VALUES (?, ?, ?, 1)')
    .run(id, name.trim(), typeof phone === 'string' ? phone.trim() : '')

  const row = db.prepare(`${SELECT_RIDER} WHERE id = ?`).get(id) as RiderRow
  res.status(201).json({ rider: serialize(row) })
})

adminRidersRouter.patch('/:id', (req, res) => {
  const existingRow = db.prepare(`${SELECT_RIDER} WHERE id = ?`).get(req.params.id) as RiderRow | undefined
  if (!existingRow) {
    res.status(404).json({ error: 'rider_not_found' })
    return
  }

  const b = { ...serialize(existingRow), ...(req.body ?? {}) } as Record<string, unknown>
  if (typeof b.name !== 'string' || !b.name.trim() || typeof b.active !== 'boolean') {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  db.prepare('UPDATE riders SET name = ?, phone = ?, active = ? WHERE id = ?')
    .run(b.name.trim(), typeof b.phone === 'string' ? b.phone.trim() : '', b.active ? 1 : 0, req.params.id)

  const row = db.prepare(`${SELECT_RIDER} WHERE id = ?`).get(req.params.id) as RiderRow
  res.json({ rider: serialize(row) })
})
