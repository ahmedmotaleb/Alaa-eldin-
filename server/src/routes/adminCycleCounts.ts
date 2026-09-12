import { Router } from 'express'
import multer from 'multer'
import { requireAdmin, requirePermission } from '../auth.js'
import { toCsv, parseCsv, csvRecords } from '../csv.js'
import {
  createCycleCount,
  listCycleCounts,
  getCycleCount,
  recordCounts,
  completeCycleCount,
  cancelCycleCount
} from '../services/cycleCountService.js'

export const adminCycleCountsRouter = Router()
adminCycleCountsRouter.use(requireAdmin)

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } })

adminCycleCountsRouter.get('/', requirePermission('inventory.view'), async (_req, res) => {
  res.json({ cycleCounts: await listCycleCounts() })
})

adminCycleCountsRouter.post('/', requirePermission('inventory.adjust'), async (req, res) => {
  const { categoryId, note } = req.body ?? {}
  if (categoryId !== undefined && categoryId !== null && typeof categoryId !== 'string') {
    res.status(400).json({ error: 'invalid_category' })
    return
  }
  const result = await createCycleCount({ categoryId: categoryId ?? null, note, userId: req.user!.id })
  if ('error' in result) {
    res.status(404).json({ error: result.error })
    return
  }
  res.status(201).json(result)
})

adminCycleCountsRouter.get('/:id', requirePermission('inventory.view'), async (req, res) => {
  const detail = await getCycleCount(String(req.params.id))
  if (!detail) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  res.json({ cycleCount: detail })
})

adminCycleCountsRouter.patch('/:id/counts', requirePermission('inventory.adjust'), async (req, res) => {
  const { counts } = req.body ?? {}
  if (!Array.isArray(counts) || counts.some((c: unknown) => typeof c !== 'object' || c === null || typeof (c as { productId?: unknown }).productId !== 'string')) {
    res.status(400).json({ error: 'invalid_counts' })
    return
  }
  const result = await recordCounts(String(req.params.id), counts)
  if ('error' in result) {
    res.status(result.error === 'not_found' ? 404 : 409).json({ error: result.error })
    return
  }
  res.json(result)
})

adminCycleCountsRouter.post('/:id/complete', requirePermission('inventory.adjust'), async (req, res) => {
  const result = await completeCycleCount(String(req.params.id), req.user!.id)
  if ('error' in result) {
    res.status(result.error === 'not_found' ? 404 : 409).json({ error: result.error })
    return
  }
  res.json(result)
})

adminCycleCountsRouter.post('/:id/cancel', requirePermission('inventory.adjust'), async (req, res) => {
  const result = await cancelCycleCount(String(req.params.id))
  if ('error' in result) {
    res.status(result.error === 'not_found' ? 404 : 409).json({ error: result.error })
    return
  }
  res.json(result)
})

// ورقة عد قابلة للطباعة/التعبئة — الكمية الفعلية بتفضل فاضية عشان تتملى يدوياً بعد العد
// الحقيقي، وترجع تاني عبر /import.
adminCycleCountsRouter.get('/:id/export', requirePermission('inventory.view'), async (req, res) => {
  const detail = await getCycleCount(String(req.params.id))
  if (!detail) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  const csv = toCsv(
    ['sku', 'barcode', 'name', 'system_quantity', 'counted_quantity'],
    detail.items.map(i => [i.sku ?? '', i.barcode, i.productName, i.systemQuantity, ''])
  )
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="cycle-count-${String(req.params.id)}.csv"`)
  res.send('﻿' + csv)
})

// استيراد الكميات المعدودة من نفس صيغة الملف المُصدَّر — المطابقة بالـ sku، وبالباركود
// كبديل لو الـ sku فاضي. صفوف بـ counted_quantity فاضية أو غير رقمية بتتجاهل بهدوء.
adminCycleCountsRouter.post('/:id/import', requirePermission('inventory.adjust'), upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'missing_file' })
    return
  }
  const detail = await getCycleCount(String(req.params.id))
  if (!detail) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  const bySku = new Map(detail.items.filter(i => i.sku).map(i => [i.sku as string, i.productId]))
  const byBarcode = new Map(detail.items.filter(i => i.barcode).map(i => [i.barcode, i.productId]))

  const records = csvRecords(parseCsv(req.file.buffer.toString('utf-8')))
  const counts: { productId: string; countedQuantity: number }[] = []
  const unmatched: string[] = []
  for (const record of records) {
    const countedRaw = record.counted_quantity?.trim()
    if (!countedRaw) continue
    const countedQuantity = Number(countedRaw)
    if (!Number.isFinite(countedQuantity)) continue

    const productId = bySku.get(record.sku?.trim()) ?? byBarcode.get(record.barcode?.trim())
    if (!productId) {
      unmatched.push(record.sku || record.barcode || '?')
      continue
    }
    counts.push({ productId, countedQuantity })
  }

  const result = await recordCounts(String(req.params.id), counts)
  if ('error' in result) {
    res.status(result.error === 'not_found' ? 404 : 409).json({ error: result.error })
    return
  }
  res.json({ ...result, unmatched })
})
