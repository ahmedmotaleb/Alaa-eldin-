import { Router } from 'express'
import multer from 'multer'
import { requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { toCsv } from '../csv.js'
import {
  generateCostTemplateCsv, previewCostCsv, confirmCostRows, todayFilenameSuffix,
  type CostConfirmRowInput
} from '../services/bulkCostService.js'
import type { ApplyResult } from '../services/bulkPricingService.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
const MAX_ROWS = 5000

export const adminBulkCostRouter = Router()
adminBulkCostRouter.use(requirePermission('products.cost.bulk_update'))

adminBulkCostRouter.get('/template', async (req, res) => {
  const filters = {
    categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
    brand: typeof req.query.brand === 'string' ? req.query.brand : undefined,
    availableOnly: req.query.availableOnly === 'true',
    outOfStockOnly: req.query.outOfStockOnly === 'true',
    hasVariants: req.query.hasVariants === 'true',
    noVariants: req.query.noVariants === 'true',
    search: typeof req.query.search === 'string' ? req.query.search : undefined
  }
  const csv = await generateCostTemplateCsv(filters)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="alaa-eldin-cost-template-${todayFilenameSuffix()}.csv"`)
  res.send(csv)
})

adminBulkCostRouter.post('/preview', upload.single('file'), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'missing_file' }); return }
  const text = req.file.buffer.toString('utf-8')
  const lineCount = text.split(/\r\n|\n/).length
  if (lineCount > MAX_ROWS + 1) { res.status(400).json({ error: 'file_too_large' }); return }

  const { rows, summary } = await previewCostCsv(text)
  res.json({ rows, summary })
})

function parseConfirmBody(body: unknown): CostConfirmRowInput[] | null {
  const b = body as Record<string, unknown>
  if (!Array.isArray(b?.rows) || b.rows.length === 0 || b.rows.length > MAX_ROWS) return null
  const rows: CostConfirmRowInput[] = []
  for (const raw of b.rows) {
    const r = raw as Record<string, unknown>
    if (typeof r?.rowNumber !== 'number' || typeof r?.record !== 'object' || r.record === null) return null
    rows.push({ rowNumber: r.rowNumber, record: r.record as Record<string, string | undefined> })
  }
  return rows
}

function summarizeApplyResultForAudit(result: ApplyResult) {
  return { batchId: result.batchId, totalRows: result.totalRows, updated: result.updated, skipped: result.skipped, failed: result.failed }
}

adminBulkCostRouter.post('/confirm', async (req, res) => {
  const rows = parseConfirmBody(req.body)
  if (!rows) { res.status(400).json({ error: 'missing_fields' }); return }

  const result = await confirmCostRows(rows, req.user!.id)
  await recordAuditLog({
    adminUserId: req.user!.id, action: 'bulk_cost_update_confirmed', entityType: 'bulk_operation_batch',
    entityId: result.batchId, newValues: summarizeApplyResultForAudit(result)
  })
  res.json(result)
})

adminBulkCostRouter.post('/confirm/report', async (req, res) => {
  const rowsBody = req.body as { rows?: unknown }
  if (!Array.isArray(rowsBody?.rows)) { res.status(400).json({ error: 'missing_fields' }); return }
  const csv = toCsv(
    ['row_number', 'product_id', 'variant_id', 'sku', 'name', 'result', 'reason'],
    (rowsBody.rows as Record<string, unknown>[]).map(r => [
      r.rowNumber, r.productId, r.variantId ?? '', r.sku ?? '', r.productName ?? '', r.result, r.reason ?? ''
    ])
  )
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="bulk-cost-result-${todayFilenameSuffix()}.csv"`)
  res.send('﻿' + csv)
})
