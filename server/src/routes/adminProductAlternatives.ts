import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin } from '../auth.js'
import { listAdminAlternatives, addAlternative, removeAlternative } from '../services/productAlternativeService.js'
import { recordAuditLog } from '../services/auditLogService.js'

export const adminProductAlternativesRouter = Router()
adminProductAlternativesRouter.use(requireAdmin)

adminProductAlternativesRouter.get('/:productId/alternatives', async (req, res) => {
  const alternatives = await listAdminAlternatives(String(req.params.productId))
  res.json({ alternatives })
})

adminProductAlternativesRouter.post('/:productId/alternatives', async (req, res) => {
  const productId = String(req.params.productId)
  const alternativeProductId = typeof req.body?.alternativeProductId === 'string' ? req.body.alternativeProductId.trim() : ''
  const priority = typeof req.body?.priority === 'number' ? req.body.priority : 0

  if (!alternativeProductId || alternativeProductId === productId) {
    res.status(400).json({ error: 'invalid_alternative' })
    return
  }

  const { rows: productRows } = await pool.query('SELECT id FROM products WHERE id = $1', [alternativeProductId])
  if (!productRows[0]) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }

  await addAlternative(productId, alternativeProductId, priority)
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'product_alternative_added',
    entityType: 'product',
    entityId: productId,
    newValues: { alternativeProductId }
  })

  const alternatives = await listAdminAlternatives(productId)
  res.status(201).json({ alternatives })
})

adminProductAlternativesRouter.delete('/:productId/alternatives/:alternativeProductId', async (req, res) => {
  const productId = String(req.params.productId)
  const alternativeProductId = String(req.params.alternativeProductId)

  await removeAlternative(productId, alternativeProductId)
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'product_alternative_removed',
    entityType: 'product',
    entityId: productId,
    oldValues: { alternativeProductId }
  })

  res.status(204).end()
})
