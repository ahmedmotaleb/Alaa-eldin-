import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { addOrderNote, listOrderNotes } from './orderNotesService.js'

const ORDER_ID = 'test-order-notes'
const USER_ID = 'test-user-notes'

async function resetFixtures() {
  await pool.query('DELETE FROM order_notes WHERE order_id = $1', [ORDER_ID])
  await pool.query('DELETE FROM orders WHERE id = $1', [ORDER_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])

  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_address, subtotal, delivery_fee, total, status)
     VALUES ($1, $1, now(), 'now', 'cod', 'عميل اختبار', '01000000000', 'عنوان', 100, 10, 110, 'placed')`,
    [ORDER_ID]
  )
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role)
     VALUES ($1, 'notes-tester@test.local', 'x', 'مختبر الملاحظات', now(), 1, 'admin')`,
    [USER_ID]
  )
}

describe('orderNotesService', () => {
  beforeEach(resetFixtures)
  afterAll(resetFixtures)

  it('adds a note attributed to the author and returns it with their name', async () => {
    const result = await addOrderNote(ORDER_ID, '  اتصلنا بالعميل لتأكيد العنوان  ', USER_ID)
    if ('error' in result) throw new Error('unexpected error')
    expect(result.note).toBe('اتصلنا بالعميل لتأكيد العنوان')
    expect(result.createdByUserId).toBe(USER_ID)
    expect(result.createdByName).toBe('مختبر الملاحظات')
  })

  it('rejects adding a note to a non-existent order', async () => {
    const result = await addOrderNote('no-such-order', 'ملاحظة', USER_ID)
    expect(result).toEqual({ error: 'order_not_found' })
  })

  it('lists notes newest first', async () => {
    await addOrderNote(ORDER_ID, 'ملاحظة أولى', USER_ID)
    await addOrderNote(ORDER_ID, 'ملاحظة ثانية', USER_ID)

    const notes = await listOrderNotes(ORDER_ID)
    expect(notes).toHaveLength(2)
    expect(notes[0].note).toBe('ملاحظة ثانية')
    expect(notes[1].note).toBe('ملاحظة أولى')
  })

  it('returns an empty list for an order with no notes', async () => {
    expect(await listOrderNotes(ORDER_ID)).toEqual([])
  })
})
