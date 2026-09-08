import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { recordAuditLog, listAuditLogs } from './auditLogService.js'

async function resetFixtures() {
  await pool.query('DELETE FROM audit_logs')
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

describe('recordAuditLog / listAuditLogs', () => {
  it('records an entry with old/new values and lists it back newest first', async () => {
    await recordAuditLog({
      adminUserId: null,
      action: 'product_updated',
      entityType: 'product',
      entityId: 'p1',
      oldValues: { price: 10 },
      newValues: { price: 12 }
    })
    await recordAuditLog({
      adminUserId: null,
      action: 'product_created',
      entityType: 'product',
      entityId: 'p2',
      newValues: { name: 'جديد' }
    })

    const { rows, total } = await listAuditLogs({ page: 1, limit: 20 })
    expect(total).toBe(2)
    // الأحدث أولاً
    expect(rows[0].action).toBe('product_created')
    expect(rows[1].action).toBe('product_updated')
    expect(rows[1].oldValues).toEqual({ price: 10 })
    expect(rows[1].newValues).toEqual({ price: 12 })
  })

  it('paginates results', async () => {
    for (let i = 0; i < 5; i++) {
      await recordAuditLog({ adminUserId: null, action: 'product_updated', entityType: 'product', entityId: `p${i}` })
    }
    const page1 = await listAuditLogs({ page: 1, limit: 2 })
    const page2 = await listAuditLogs({ page: 2, limit: 2 })
    expect(page1.rows).toHaveLength(2)
    expect(page2.rows).toHaveLength(2)
    expect(page1.total).toBe(5)
    expect(page1.rows[0].id).not.toBe(page2.rows[0].id)
  })
})
