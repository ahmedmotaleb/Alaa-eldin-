import { Router } from 'express'
import { requireAdmin, requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import {
  createSupplierReturn, listSupplierReturns, getSupplierReturnById, updateSupplierReturnStatus,
  type SupplierReturnInput, type SupplierReturnStatus
} from '../services/supplierReturnService.js'

export const adminSupplierReturnsRouter = Router()
adminSupplierReturnsRouter.use(requireAdmin)

const VALID_STATUSES: SupplierReturnStatus[] = ['draft', 'approved', 'sent', 'completed', 'cancelled']

function parseInput(body: unknown): SupplierReturnInput | null {
  const b = body as Record<string, unknown>
  if (typeof b?.supplierId !== 'string' || !b.supplierId.trim() || !Array.isArray(b.items)) return null
  const items = b.items.map((raw: unknown) => {
    const item = raw as Record<string, unknown>
    return {
      productId: typeof item?.productId === 'string' ? item.productId : '',
      batchId: typeof item?.batchId === 'string' ? item.batchId : null,
      quantity: typeof item?.quantity === 'number' ? item.quantity : NaN,
      unitCost: typeof item?.unitCost === 'number' ? item.unitCost : 0
    }
  })
  return {
    supplierId: b.supplierId,
    purchaseOrderId: typeof b.purchaseOrderId === 'string' ? b.purchaseOrderId : null,
    reason: typeof b.reason === 'string' ? b.reason : '',
    items
  }
}

adminSupplierReturnsRouter.get('/', requirePermission('returns.manage'), async (req, res) => {
  const status = typeof req.query.status === 'string' && VALID_STATUSES.includes(req.query.status as SupplierReturnStatus)
    ? req.query.status as SupplierReturnStatus : undefined
  const supplierId = typeof req.query.supplierId === 'string' ? req.query.supplierId : undefined
  const returns = await listSupplierReturns({ status, supplierId })
  res.json({ returns })
})

adminSupplierReturnsRouter.get('/:id', requirePermission('returns.manage'), async (req, res) => {
  const result = await getSupplierReturnById(String(req.params.id))
  if (!result) { res.status(404).json({ error: 'supplier_return_not_found' }); return }
  res.json(result)
})

adminSupplierReturnsRouter.post('/', requirePermission('returns.manage'), async (req, res) => {
  const input = parseInput(req.body)
  if (!input) { res.status(400).json({ error: 'missing_fields' }); return }

  try {
    const supplierReturn = await createSupplierReturn(input, req.user!.id)
    await recordAuditLog({
      adminUserId: req.user!.id, action: 'supplier_return_created', entityType: 'supplier_return',
      entityId: supplierReturn.id, newValues: { returnNumber: supplierReturn.returnNumber, supplierId: supplierReturn.supplierId }
    })
    res.status(201).json({ supplierReturn })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'invalid_input' })
  }
})

adminSupplierReturnsRouter.patch('/:id/status', requirePermission('returns.manage'), async (req, res) => {
  const toStatus = req.body?.status
  if (typeof toStatus !== 'string' || !VALID_STATUSES.includes(toStatus as SupplierReturnStatus)) {
    res.status(400).json({ error: 'invalid_status' })
    return
  }

  const result = await updateSupplierReturnStatus(String(req.params.id), toStatus as SupplierReturnStatus, req.user!.id)
  if ('error' in result) {
    const status = result.error === 'not_found' ? 404 : 409
    res.status(status).json({ error: result.error })
    return
  }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: `supplier_return_${toStatus}`,
    entityType: 'supplier_return',
    entityId: result.id,
    newValues: { status: result.status }
  })
  res.json({ supplierReturn: result })
})
