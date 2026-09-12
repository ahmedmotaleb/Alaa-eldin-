import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin, requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import {
  listSuppliers, getSupplierById, createSupplier, updateSupplier, setSupplierActive,
  listSupplierProductsForSupplier, upsertSupplierProduct, removeSupplierProduct,
  type SupplierInput
} from '../services/supplierService.js'

export const adminSuppliersRouter = Router()
adminSuppliersRouter.use(requireAdmin)

function validateInput(body: unknown): SupplierInput | null {
  const b = body as Record<string, unknown>
  if (typeof b?.name !== 'string' || !b.name.trim()) return null
  const optionalString = (v: unknown) => (typeof v === 'string' ? v : undefined)
  return {
    name: b.name,
    contactPerson: optionalString(b.contactPerson),
    mobile: optionalString(b.mobile),
    whatsapp: optionalString(b.whatsapp),
    email: optionalString(b.email),
    address: optionalString(b.address),
    taxNumber: optionalString(b.taxNumber),
    notes: optionalString(b.notes)
  }
}

adminSuppliersRouter.get('/', requirePermission('purchases.view'), async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined
  const activeOnly = req.query.activeOnly === 'true'
  const suppliers = await listSuppliers({ search, activeOnly })
  res.json({ suppliers })
})

adminSuppliersRouter.get('/:id', requirePermission('purchases.view'), async (req, res) => {
  const supplier = await getSupplierById(String(req.params.id))
  if (!supplier) { res.status(404).json({ error: 'supplier_not_found' }); return }
  const products = await listSupplierProductsForSupplier(supplier.id)
  res.json({ supplier, products })
})

adminSuppliersRouter.post('/', requirePermission('purchases.create'), async (req, res) => {
  const input = validateInput(req.body)
  if (!input) { res.status(400).json({ error: 'missing_fields' }); return }

  const supplier = await createSupplier(input)
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'supplier_created',
    entityType: 'supplier',
    entityId: supplier.id,
    newValues: { name: supplier.name }
  })
  res.status(201).json({ supplier })
})

adminSuppliersRouter.patch('/:id', requirePermission('purchases.create'), async (req, res) => {
  const input = validateInput(req.body)
  if (!input) { res.status(400).json({ error: 'missing_fields' }); return }

  const before = await getSupplierById(String(req.params.id))
  if (!before) { res.status(404).json({ error: 'supplier_not_found' }); return }

  const supplier = await updateSupplier(before.id, input)
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'supplier_updated',
    entityType: 'supplier',
    entityId: before.id,
    oldValues: before,
    newValues: supplier
  })
  res.json({ supplier })
})

adminSuppliersRouter.patch('/:id/active', requirePermission('purchases.create'), async (req, res) => {
  const active = req.body?.active
  if (typeof active !== 'boolean') { res.status(400).json({ error: 'invalid_active' }); return }

  const supplier = await setSupplierActive(String(req.params.id), active)
  if (!supplier) { res.status(404).json({ error: 'supplier_not_found' }); return }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: active ? 'supplier_activated' : 'supplier_deactivated',
    entityType: 'supplier',
    entityId: supplier.id
  })
  res.json({ supplier })
})

// ربط منتج بمورد — يُستخدم لاحقاً في اقتراحات الشراء وأوامر الشراء الافتراضية.
adminSuppliersRouter.put('/:id/products/:productId', requirePermission('purchases.create'), async (req, res) => {
  const supplier = await getSupplierById(String(req.params.id))
  if (!supplier) { res.status(404).json({ error: 'supplier_not_found' }); return }

  const { rows: productRows } = await pool.query('SELECT id FROM products WHERE id = $1', [req.params.productId])
  if (!productRows[0]) { res.status(404).json({ error: 'product_not_found' }); return }

  const b = req.body as Record<string, unknown>
  const link = await upsertSupplierProduct(supplier.id, String(req.params.productId), {
    supplierSku: typeof b?.supplierSku === 'string' ? b.supplierSku : undefined,
    lastCost: typeof b?.lastCost === 'number' ? b.lastCost : null,
    leadTimeDays: typeof b?.leadTimeDays === 'number' ? b.leadTimeDays : null,
    minimumOrderQty: typeof b?.minimumOrderQty === 'number' ? b.minimumOrderQty : null,
    preferred: b?.preferred === true
  })

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'supplier_product_linked',
    entityType: 'supplier',
    entityId: supplier.id,
    newValues: { productId: req.params.productId, preferred: link.preferred }
  })
  res.json({ link })
})

adminSuppliersRouter.delete('/:id/products/:productId', requirePermission('purchases.create'), async (req, res) => {
  await removeSupplierProduct(String(req.params.id), String(req.params.productId))
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'supplier_product_unlinked',
    entityType: 'supplier',
    entityId: String(req.params.id),
    oldValues: { productId: req.params.productId }
  })
  res.status(204).end()
})
