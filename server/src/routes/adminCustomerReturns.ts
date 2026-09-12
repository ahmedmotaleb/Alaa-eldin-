import { Router } from 'express'
import { requireAdmin, requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import {
  createCustomerReturn, listCustomerReturns, getCustomerReturnById, updateCustomerReturnStatus,
  type CustomerReturnInput, type CustomerReturnStatus, type ReturnItemCondition
} from '../services/customerReturnService.js'
import { pool } from '../db.js'

export const adminCustomerReturnsRouter = Router()
adminCustomerReturnsRouter.use(requireAdmin)

const VALID_STATUSES: CustomerReturnStatus[] = ['requested', 'approved', 'received', 'refunded', 'rejected', 'cancelled']
const VALID_CONDITIONS: ReturnItemCondition[] = ['return_to_stock', 'damaged', 'expired', 'discard']

const ACTION_BY_STATUS: Record<CustomerReturnStatus, string> = {
  requested: 'return_created',
  approved: 'return_approved',
  received: 'return_received',
  refunded: 'return_refunded',
  rejected: 'return_rejected',
  cancelled: 'return_cancelled'
}

function parseInput(body: unknown): CustomerReturnInput | null {
  const b = body as Record<string, unknown>
  if (typeof b?.orderId !== 'string' || !b.orderId.trim() || !Array.isArray(b.items)) return null
  const items = b.items.map((raw: unknown) => {
    const item = raw as Record<string, unknown>
    return {
      orderItemId: typeof item?.orderItemId === 'number' ? item.orderItemId : NaN,
      productId: typeof item?.productId === 'string' ? item.productId : '',
      quantity: typeof item?.quantity === 'number' ? item.quantity : NaN,
      condition: VALID_CONDITIONS.includes(item?.condition as ReturnItemCondition) ? item.condition as ReturnItemCondition : 'return_to_stock'
    }
  })
  return {
    orderId: b.orderId,
    reason: typeof b.reason === 'string' ? b.reason : '',
    notes: typeof b.notes === 'string' ? b.notes : '',
    items
  }
}

adminCustomerReturnsRouter.get('/', requirePermission('returns.manage'), async (req, res) => {
  const status = typeof req.query.status === 'string' && VALID_STATUSES.includes(req.query.status as CustomerReturnStatus)
    ? req.query.status as CustomerReturnStatus : undefined
  const orderId = typeof req.query.orderId === 'string' ? req.query.orderId : undefined
  const returns = await listCustomerReturns({ status, orderId })
  res.json({ returns })
})

adminCustomerReturnsRouter.get('/:id', requirePermission('returns.manage'), async (req, res) => {
  const result = await getCustomerReturnById(String(req.params.id))
  if (!result) { res.status(404).json({ error: 'customer_return_not_found' }); return }
  res.json(result)
})

adminCustomerReturnsRouter.post('/', requirePermission('returns.manage'), async (req, res) => {
  const input = parseInput(req.body)
  if (!input) { res.status(400).json({ error: 'missing_fields' }); return }

  const result = await createCustomerReturn(input, req.user!.id)
  if ('error' in result) {
    const status = result.error === 'order_not_found' ? 404 : 400
    res.status(status).json({ error: result.error, orderItemId: result.orderItemId })
    return
  }

  await recordAuditLog({
    adminUserId: req.user!.id, action: 'return_created', entityType: 'customer_return',
    entityId: result.id, newValues: { returnNumber: result.returnNumber, orderId: result.orderId, refundAmount: result.refundAmount }
  })
  res.status(201).json({ customerReturn: result })
})

adminCustomerReturnsRouter.patch('/:id/status', requirePermission('returns.manage'), async (req, res) => {
  const toStatus = req.body?.status
  if (typeof toStatus !== 'string' || !VALID_STATUSES.includes(toStatus as CustomerReturnStatus)) {
    res.status(400).json({ error: 'invalid_status' })
    return
  }

  const result = await updateCustomerReturnStatus(String(req.params.id), toStatus as CustomerReturnStatus)
  if ('error' in result) {
    const status = result.error === 'not_found' ? 404 : 409
    res.status(status).json({ error: result.error })
    return
  }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: ACTION_BY_STATUS[toStatus as CustomerReturnStatus],
    entityType: 'customer_return',
    entityId: result.id,
    newValues: { status: result.status, orderId: result.orderId }
  })

  // "return_restocked" حدث منفصل عن "return_received" — بيتسجّل بس لو فعلاً فيه صنف
  // اترجّع للمخزون (condition = 'return_to_stock')، مش لكل استلام مرتجع بشكل عام.
  if (toStatus === 'received') {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*) as n FROM customer_return_items WHERE customer_return_id = $1 AND condition = 'return_to_stock'`,
      [result.id]
    )
    if (Number(rows[0].n) > 0) {
      await recordAuditLog({
        adminUserId: req.user!.id, action: 'return_restocked', entityType: 'customer_return',
        entityId: result.id, newValues: { orderId: result.orderId }
      })
    }
  }

  res.json({ customerReturn: result })
})
