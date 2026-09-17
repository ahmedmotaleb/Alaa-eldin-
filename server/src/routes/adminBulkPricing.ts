import { Router } from 'express'
import multer from 'multer'
import { requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { toCsv } from '../csv.js'
import {
  generatePricingTemplateCsv, previewPricingCsv, confirmPricingRows, todayFilenameSuffix,
  previewAdjustment, confirmAdjustment, PRICING_TEMPLATE_VERSION,
  type ConfirmRowInput, type AdjustmentInput, type ApplyResult
} from '../services/bulkPricingService.js'
import { listBatches, getBatchDetail, rollbackBatch } from '../services/bulkOperationBatchService.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
const MAX_ROWS = 5000

export const adminBulkPricingRouter = Router()
adminBulkPricingRouter.use(requirePermission('products.pricing.bulk_update'))

adminBulkPricingRouter.get('/template', async (req, res) => {
  const filters = {
    categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
    brand: typeof req.query.brand === 'string' ? req.query.brand : undefined,
    availableOnly: req.query.availableOnly === 'true',
    outOfStockOnly: req.query.outOfStockOnly === 'true',
    hasVariants: req.query.hasVariants === 'true',
    noVariants: req.query.noVariants === 'true',
    search: typeof req.query.search === 'string' ? req.query.search : undefined
  }
  const csv = await generatePricingTemplateCsv(filters)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="alaa-eldin-pricing-template-${todayFilenameSuffix()}.csv"`)
  res.send(csv)
})

adminBulkPricingRouter.post('/preview', upload.single('file'), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'missing_file' }); return }
  const text = req.file.buffer.toString('utf-8')
  const lineCount = text.split(/\r\n|\n/).length
  if (lineCount > MAX_ROWS + 1) { res.status(400).json({ error: 'file_too_large' }); return }

  const { rows, summary } = await previewPricingCsv(text)
  res.json({ rows, summary })
})

function parseConfirmBody(body: unknown): ConfirmRowInput[] | null {
  const b = body as Record<string, unknown>
  if (!Array.isArray(b?.rows) || b.rows.length === 0 || b.rows.length > MAX_ROWS) return null
  const rows: ConfirmRowInput[] = []
  for (const raw of b.rows) {
    const r = raw as Record<string, unknown>
    if (typeof r?.rowNumber !== 'number' || typeof r?.record !== 'object' || r.record === null) return null
    rows.push({ rowNumber: r.rowNumber, record: r.record as Record<string, string | undefined> })
  }
  return rows
}

function summarizeApplyResultForAudit(result: ApplyResult) {
  return {
    batchId: result.batchId, totalRows: result.totalRows, updated: result.updated, skipped: result.skipped, failed: result.failed
  }
}

// التأكيد بياخد صفوف الملف الخام (record) بالظبط زي ما اتقرت من الـ CSV، مش أي قيمة محسوبة
// من المعاينة — السيرفر بيعيد التحقق والتطبيق بالكامل من الصفر (راجع confirmPricingRows).
adminBulkPricingRouter.post('/confirm', async (req, res) => {
  const rows = parseConfirmBody(req.body)
  if (!rows) { res.status(400).json({ error: 'missing_fields' }); return }

  const result = await confirmPricingRows(rows, req.user!.id)
  await recordAuditLog({
    adminUserId: req.user!.id, action: 'bulk_price_update_confirmed', entityType: 'bulk_operation_batch',
    entityId: result.batchId, newValues: summarizeApplyResultForAudit(result)
  })
  res.json(result)
})

adminBulkPricingRouter.post('/confirm/report', async (req, res) => {
  const rowsBody = req.body as { rows?: unknown }
  if (!Array.isArray(rowsBody?.rows)) { res.status(400).json({ error: 'missing_fields' }); return }
  const csv = toCsv(
    ['row_number', 'product_id', 'variant_id', 'sku', 'name', 'result', 'reason'],
    (rowsBody.rows as Record<string, unknown>[]).map(r => [
      r.rowNumber, r.productId, r.variantId ?? '', r.sku ?? '', r.productName ?? '', r.result, r.reason ?? ''
    ])
  )
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="bulk-pricing-result-${todayFilenameSuffix()}.csv"`)
  res.send('﻿' + csv)
})

function parseAdjustmentInput(body: unknown): AdjustmentInput | null {
  const b = body as Record<string, unknown>
  const scope = b?.scope as Record<string, unknown>
  if (!scope) return null
  const operation = b?.operation
  if (operation !== 'increase_percent' && operation !== 'decrease_percent' && operation !== 'increase_fixed' && operation !== 'decrease_fixed') return null
  if (typeof b?.value !== 'number' || b.value <= 0) return null
  const rounding = b?.rounding
  if (rounding !== 'none' && rounding !== 'nearest_0_5' && rounding !== 'nearest_1' && rounding !== 'nearest_5') return null

  return {
    scope: {
      productIds: Array.isArray(scope.productIds) ? scope.productIds.filter((x): x is string => typeof x === 'string') : undefined,
      categoryId: typeof scope.categoryId === 'string' ? scope.categoryId : undefined,
      brand: typeof scope.brand === 'string' ? scope.brand : undefined,
      allCatalog: scope.allCatalog === true
    },
    operation,
    value: b.value,
    rounding
  }
}

adminBulkPricingRouter.post('/adjustment-preview', async (req, res) => {
  const input = parseAdjustmentInput(req.body)
  if (!input) { res.status(400).json({ error: 'missing_fields' }); return }
  const { rows, summary } = await previewAdjustment(input)
  res.json({ rows, summary })
})

adminBulkPricingRouter.post('/adjustment-confirm', async (req, res) => {
  const input = parseAdjustmentInput(req.body)
  const selectedProductIds = (req.body as { selectedProductIds?: unknown })?.selectedProductIds
  if (!input || !Array.isArray(selectedProductIds) || selectedProductIds.length === 0) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const result = await confirmAdjustment(input, selectedProductIds.filter((x): x is string => typeof x === 'string'), req.user!.id)
  await recordAuditLog({
    adminUserId: req.user!.id, action: 'bulk_price_adjustment_confirmed', entityType: 'bulk_operation_batch',
    entityId: result.batchId, newValues: summarizeApplyResultForAudit(result)
  })
  res.json(result)
})

adminBulkPricingRouter.get('/batches', async (req, res) => {
  const operationType = req.query.operationType === 'bulk_price_csv' || req.query.operationType === 'bulk_price_adjustment'
    ? req.query.operationType
    : undefined
  res.json({ batches: await listBatches(operationType) })
})

adminBulkPricingRouter.get('/batches/:id', async (req, res) => {
  const detail = await getBatchDetail(String(req.params.id))
  if (!detail) { res.status(404).json({ error: 'batch_not_found' }); return }
  res.json(detail)
})

adminBulkPricingRouter.post('/batches/:id/rollback', async (req, res) => {
  const detail = await getBatchDetail(String(req.params.id))
  if (!detail) { res.status(404).json({ error: 'batch_not_found' }); return }

  const result = await rollbackBatch(String(req.params.id), req.user!.id)
  res.json(result)
})

export const PRICING_TEMPLATE_VERSION_FOR_CLIENT = PRICING_TEMPLATE_VERSION
