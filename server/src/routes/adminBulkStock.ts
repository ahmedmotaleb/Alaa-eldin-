import { Router } from 'express'
import multer from 'multer'
import { requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { toCsv } from '../csv.js'
import {
  generateStockTemplateCsv, previewStockCsv, confirmStockRows, todayFilenameSuffix,
  previewStockAdjustment, confirmStockAdjustment, STOCK_TEMPLATE_VERSION,
  type StockConfirmRowInput, type StockAdjustmentInput
} from '../services/bulkStockService.js'
import type { ApplyResult } from '../services/bulkPricingService.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
const MAX_ROWS = 5000

export const adminBulkStockRouter = Router()
adminBulkStockRouter.use(requirePermission('inventory.adjust'))

adminBulkStockRouter.get('/template', async (req, res) => {
  const filters = {
    categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
    brand: typeof req.query.brand === 'string' ? req.query.brand : undefined,
    availableOnly: req.query.availableOnly === 'true',
    outOfStockOnly: req.query.outOfStockOnly === 'true',
    hasVariants: req.query.hasVariants === 'true',
    noVariants: req.query.noVariants === 'true',
    search: typeof req.query.search === 'string' ? req.query.search : undefined
  }
  const csv = await generateStockTemplateCsv(filters)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="alaa-eldin-stock-template-${todayFilenameSuffix()}.csv"`)
  res.send(csv)
})

adminBulkStockRouter.post('/preview', upload.single('file'), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'missing_file' }); return }
  const text = req.file.buffer.toString('utf-8')
  const lineCount = text.split(/\r\n|\n/).length
  if (lineCount > MAX_ROWS + 1) { res.status(400).json({ error: 'file_too_large' }); return }

  const { rows, summary } = await previewStockCsv(text)
  res.json({ rows, summary })
})

function parseConfirmBody(body: unknown): StockConfirmRowInput[] | null {
  const b = body as Record<string, unknown>
  if (!Array.isArray(b?.rows) || b.rows.length === 0 || b.rows.length > MAX_ROWS) return null
  const rows: StockConfirmRowInput[] = []
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

adminBulkStockRouter.post('/confirm', async (req, res) => {
  const rows = parseConfirmBody(req.body)
  if (!rows) { res.status(400).json({ error: 'missing_fields' }); return }

  const result = await confirmStockRows(rows, req.user!.id)
  await recordAuditLog({
    adminUserId: req.user!.id, action: 'bulk_stock_update_confirmed', entityType: 'bulk_operation_batch',
    entityId: result.batchId, newValues: summarizeApplyResultForAudit(result)
  })
  res.json(result)
})

adminBulkStockRouter.post('/confirm/report', async (req, res) => {
  const rowsBody = req.body as { rows?: unknown }
  if (!Array.isArray(rowsBody?.rows)) { res.status(400).json({ error: 'missing_fields' }); return }
  const csv = toCsv(
    ['row_number', 'product_id', 'variant_id', 'sku', 'name', 'result', 'reason'],
    (rowsBody.rows as Record<string, unknown>[]).map(r => [
      r.rowNumber, r.productId, r.variantId ?? '', r.sku ?? '', r.productName ?? '', r.result, r.reason ?? ''
    ])
  )
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="bulk-stock-result-${todayFilenameSuffix()}.csv"`)
  res.send('﻿' + csv)
})

function parseAdjustmentInput(body: unknown): StockAdjustmentInput | null {
  const b = body as Record<string, unknown>
  const scope = b?.scope as Record<string, unknown>
  if (!scope) return null
  const operation = b?.operation
  if (operation !== 'set_to' && operation !== 'increase_by' && operation !== 'decrease_by') return null
  if (typeof b?.value !== 'number' || !Number.isInteger(b.value) || b.value < 0) return null
  const reason = b?.reason
  if (reason !== 'restock' && reason !== 'return' && reason !== 'damage' && reason !== 'loss' && reason !== 'adjustment') return null

  return {
    scope: {
      productIds: Array.isArray(scope.productIds) ? scope.productIds.filter((x): x is string => typeof x === 'string') : undefined,
      categoryId: typeof scope.categoryId === 'string' ? scope.categoryId : undefined,
      brand: typeof scope.brand === 'string' ? scope.brand : undefined,
      allCatalog: scope.allCatalog === true
    },
    operation, value: b.value, reason
  }
}

adminBulkStockRouter.post('/adjustment-preview', async (req, res) => {
  const input = parseAdjustmentInput(req.body)
  if (!input) { res.status(400).json({ error: 'missing_fields' }); return }
  const { rows, summary } = await previewStockAdjustment(input)
  res.json({ rows, summary })
})

adminBulkStockRouter.post('/adjustment-confirm', async (req, res) => {
  const input = parseAdjustmentInput(req.body)
  const selectedProductIds = (req.body as { selectedProductIds?: unknown })?.selectedProductIds
  if (!input || !Array.isArray(selectedProductIds) || selectedProductIds.length === 0) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const result = await confirmStockAdjustment(input, selectedProductIds.filter((x): x is string => typeof x === 'string'), req.user!.id)
  await recordAuditLog({
    adminUserId: req.user!.id, action: 'bulk_stock_adjustment_confirmed', entityType: 'bulk_operation_batch',
    entityId: result.batchId, newValues: summarizeApplyResultForAudit(result)
  })
  res.json(result)
})

export const STOCK_TEMPLATE_VERSION_FOR_CLIENT = STOCK_TEMPLATE_VERSION
