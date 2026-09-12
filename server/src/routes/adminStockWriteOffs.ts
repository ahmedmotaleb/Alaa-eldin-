import { Router } from 'express'
import { requireAdmin, requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { writeOffStock, type WriteOffReason } from '../services/stockWriteOffService.js'

export const adminStockWriteOffsRouter = Router()
adminStockWriteOffsRouter.use(requireAdmin)

const VALID_REASONS: WriteOffReason[] = ['expired', 'damaged', 'lost', 'inventory_adjustment', 'supplier_return']

adminStockWriteOffsRouter.post('/', requirePermission('inventory.adjust'), async (req, res) => {
  const b = req.body as Record<string, unknown>
  if (
    typeof b?.productId !== 'string' || !b.productId.trim() ||
    typeof b?.quantity !== 'number' ||
    typeof b?.reason !== 'string' || !VALID_REASONS.includes(b.reason as WriteOffReason)
  ) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const result = await writeOffStock(req.user!.id, {
    productId: b.productId,
    quantity: b.quantity,
    reason: b.reason as WriteOffReason,
    note: typeof b.note === 'string' ? b.note : '',
    batchId: typeof b.batchId === 'string' ? b.batchId : undefined
  })

  if ('error' in result) {
    const status = result.error === 'product_not_found' ? 404 : 400
    res.status(status).json({ error: result.error })
    return
  }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'stock_write_off',
    entityType: 'product',
    entityId: b.productId,
    newValues: { reason: b.reason, quantity: b.quantity, newStock: result.newStock }
  })
  res.status(201).json({ newStock: result.newStock })
})
