import { Router } from 'express'
import { requireAdmin, requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import {
  listPurchaseOrders, getPurchaseOrderById, createPurchaseOrder, updateDraftPurchaseOrder, updatePurchaseOrderStatus,
  type PurchaseOrderInput, type PurchaseOrderStatus
} from '../services/purchaseOrderService.js'

export const adminPurchaseOrdersRouter = Router()
adminPurchaseOrdersRouter.use(requireAdmin)

const VALID_STATUSES: PurchaseOrderStatus[] = ['draft', 'submitted', 'partially_received', 'received', 'cancelled']

function parseInput(body: unknown): PurchaseOrderInput | null {
  const b = body as Record<string, unknown>
  if (typeof b?.supplierId !== 'string' || !b.supplierId.trim()) return null
  if (!Array.isArray(b.items)) return null
  const items = b.items.map((raw: unknown) => {
    const item = raw as Record<string, unknown>
    return {
      productId: typeof item?.productId === 'string' ? item.productId : '',
      orderedQty: typeof item?.orderedQty === 'number' ? item.orderedQty : NaN,
      unitCost: typeof item?.unitCost === 'number' ? item.unitCost : NaN
    }
  })
  return {
    supplierId: b.supplierId,
    expectedDate: typeof b.expectedDate === 'string' ? b.expectedDate : null,
    notes: typeof b.notes === 'string' ? b.notes : '',
    discount: typeof b.discount === 'number' ? b.discount : 0,
    shippingCost: typeof b.shippingCost === 'number' ? b.shippingCost : 0,
    items
  }
}

adminPurchaseOrdersRouter.get('/', requirePermission('purchases.view'), async (req, res) => {
  const status = typeof req.query.status === 'string' && VALID_STATUSES.includes(req.query.status as PurchaseOrderStatus)
    ? req.query.status as PurchaseOrderStatus
    : undefined
  const supplierId = typeof req.query.supplierId === 'string' ? req.query.supplierId : undefined
  const search = typeof req.query.search === 'string' ? req.query.search : undefined
  const orders = await listPurchaseOrders({ status, supplierId, search })
  res.json({ orders })
})

adminPurchaseOrdersRouter.get('/:id', requirePermission('purchases.view'), async (req, res) => {
  const result = await getPurchaseOrderById(String(req.params.id))
  if (!result) { res.status(404).json({ error: 'purchase_order_not_found' }); return }
  res.json(result)
})

adminPurchaseOrdersRouter.post('/', requirePermission('purchases.create'), async (req, res) => {
  const input = parseInput(req.body)
  if (!input) { res.status(400).json({ error: 'missing_fields' }); return }

  try {
    const order = await createPurchaseOrder(input, req.user!.id)
    await recordAuditLog({
      adminUserId: req.user!.id,
      action: 'purchase_order_created',
      entityType: 'purchase_order',
      entityId: order.id,
      newValues: { poNumber: order.poNumber, supplierId: order.supplierId, total: order.total }
    })
    res.status(201).json({ order })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid_input'
    res.status(400).json({ error: message })
  }
})

adminPurchaseOrdersRouter.patch('/:id', requirePermission('purchases.create'), async (req, res) => {
  const input = parseInput(req.body)
  if (!input) { res.status(400).json({ error: 'missing_fields' }); return }

  const result = await updateDraftPurchaseOrder(String(req.params.id), input)
  if ('error' in result) {
    const status = result.error === 'not_found' ? 404 : 400
    res.status(status).json({ error: result.error })
    return
  }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'purchase_order_updated',
    entityType: 'purchase_order',
    entityId: result.id,
    newValues: { total: result.total }
  })
  res.json({ order: result })
})

adminPurchaseOrdersRouter.patch('/:id/status', requirePermission('purchases.create'), async (req, res) => {
  const toStatus = req.body?.status
  if (typeof toStatus !== 'string' || !VALID_STATUSES.includes(toStatus as PurchaseOrderStatus)) {
    res.status(400).json({ error: 'invalid_status' })
    return
  }

  const result = await updatePurchaseOrderStatus(String(req.params.id), toStatus as PurchaseOrderStatus)
  if ('error' in result) {
    const status = result.error === 'not_found' ? 404 : 409
    res.status(status).json({ error: result.error })
    return
  }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: toStatus === 'cancelled' ? 'purchase_order_cancelled' : 'purchase_order_submitted',
    entityType: 'purchase_order',
    entityId: result.id,
    newValues: { status: result.status }
  })
  res.json({ order: result })
})
