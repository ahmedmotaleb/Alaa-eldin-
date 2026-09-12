import { Router } from 'express'
import { requireAdmin, requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { receiveGoodsForPurchaseOrder, listGoodsReceipts, getGoodsReceiptById, type ReceiveItemInput } from '../services/goodsReceivingService.js'

export const adminGoodsReceivingRouter = Router()
adminGoodsReceivingRouter.use(requireAdmin)

adminGoodsReceivingRouter.get('/', requirePermission('purchases.view'), async (req, res) => {
  const purchaseOrderId = typeof req.query.purchaseOrderId === 'string' ? req.query.purchaseOrderId : undefined
  const receipts = await listGoodsReceipts({ purchaseOrderId })
  res.json({ receipts })
})

adminGoodsReceivingRouter.get('/:id', requirePermission('purchases.view'), async (req, res) => {
  const result = await getGoodsReceiptById(String(req.params.id))
  if (!result) { res.status(404).json({ error: 'goods_receipt_not_found' }); return }
  res.json(result)
})

adminGoodsReceivingRouter.post('/', requirePermission('purchases.receive'), async (req, res) => {
  const b = req.body as Record<string, unknown>
  if (typeof b?.purchaseOrderId !== 'string' || !b.purchaseOrderId.trim() || !Array.isArray(b.items)) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const items: ReceiveItemInput[] = b.items.map((raw: unknown) => {
    const item = raw as Record<string, unknown>
    return {
      productId: typeof item?.productId === 'string' ? item.productId : '',
      quantity: typeof item?.quantity === 'number' ? item.quantity : NaN,
      unitCost: typeof item?.unitCost === 'number' ? item.unitCost : NaN,
      batchNumber: typeof item?.batchNumber === 'string' ? item.batchNumber : null,
      expiryDate: typeof item?.expiryDate === 'string' ? item.expiryDate : null,
      manufacturedDate: typeof item?.manufacturedDate === 'string' ? item.manufacturedDate : null
    }
  })

  const result = await receiveGoodsForPurchaseOrder(
    { purchaseOrderId: b.purchaseOrderId, items, notes: typeof b.notes === 'string' ? b.notes : '' },
    req.user!.id
  )

  if ('error' in result) {
    const status = result.error === 'purchase_order_not_found' || result.error === 'product_not_found' ? 404
      : result.error === 'purchase_order_not_receivable' ? 409
      : 400
    res.status(status).json({ error: result.error, productId: result.productId })
    return
  }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'goods_receipt_created',
    entityType: 'goods_receipt',
    entityId: result.receipt.id,
    newValues: { receiptNumber: result.receipt.receiptNumber, purchaseOrderId: result.receipt.purchaseOrderId, itemCount: result.items.length }
  })
  res.status(201).json(result)
})
