import { Router } from 'express'
import { requireAdmin } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import {
  listAllDeliveryZones, updateDeliveryZone,
  listAllDeliverySlots, createDeliverySlot, updateDeliverySlot
} from '../services/deliveryService.js'

export const adminDeliveryRouter = Router()
adminDeliveryRouter.use(requireAdmin)

adminDeliveryRouter.get('/zones', async (_req, res) => {
  res.json({ zones: await listAllDeliveryZones() })
})

// مفيش إضافة/حذف محافظة — القايمة جغرافية ثابتة (الـ27 محافظة)؛ الأدمن بس بيعدّل رسوم
// التوصيل أو يوقّف/يشغّل التوصيل لمحافظة معينة.
adminDeliveryRouter.patch('/zones/:governorate', async (req, res) => {
  const governorate = String(req.params.governorate)
  const b = req.body as Record<string, unknown>
  if (typeof b?.deliveryFee !== 'number' || b.deliveryFee < 0 || typeof b?.isActive !== 'boolean') {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const zone = await updateDeliveryZone(governorate, { deliveryFee: b.deliveryFee, isActive: b.isActive })
  if (!zone) {
    res.status(404).json({ error: 'delivery_zone_not_found' })
    return
  }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'delivery_zone_updated',
    entityType: 'delivery_zone',
    entityId: governorate,
    newValues: { deliveryFee: zone.deliveryFee, isActive: zone.isActive }
  })
  res.json({ zone })
})

adminDeliveryRouter.get('/slots', async (_req, res) => {
  res.json({ slots: await listAllDeliverySlots() })
})

const SLOT_ID_PATTERN = /^[a-z0-9_-]{1,40}$/

function parseMaxOrdersPerDay(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' || value <= 0 || !Number.isInteger(value)) return undefined
  return value
}

adminDeliveryRouter.post('/slots', async (req, res) => {
  const b = req.body as Record<string, unknown>
  const id = typeof b?.id === 'string' ? b.id.trim() : ''
  const maxOrdersPerDay = parseMaxOrdersPerDay(b?.maxOrdersPerDay)
  if (
    !SLOT_ID_PATTERN.test(id) ||
    typeof b?.label !== 'string' || !b.label.trim() ||
    typeof b?.note !== 'string' || typeof b?.isActive !== 'boolean' ||
    maxOrdersPerDay === undefined
  ) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  try {
    const slot = await createDeliverySlot({ id, label: b.label.trim(), note: b.note.trim(), isActive: b.isActive, maxOrdersPerDay })
    await recordAuditLog({
      adminUserId: req.user!.id,
      action: 'delivery_slot_created',
      entityType: 'delivery_slot',
      entityId: id,
      newValues: slot
    })
    res.status(201).json({ slot })
  } catch (err) {
    if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'delivery_slot_id_taken' })
      return
    }
    throw err
  }
})

adminDeliveryRouter.patch('/slots/:id', async (req, res) => {
  const id = String(req.params.id)
  const b = req.body as Record<string, unknown>
  const maxOrdersPerDay = parseMaxOrdersPerDay(b?.maxOrdersPerDay)
  if (
    typeof b?.label !== 'string' || !b.label.trim() || typeof b?.note !== 'string' || typeof b?.isActive !== 'boolean' ||
    maxOrdersPerDay === undefined
  ) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const slot = await updateDeliverySlot(id, { label: b.label.trim(), note: b.note.trim(), isActive: b.isActive, maxOrdersPerDay })
  if (!slot) {
    res.status(404).json({ error: 'delivery_slot_not_found' })
    return
  }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'delivery_slot_updated',
    entityType: 'delivery_slot',
    entityId: id,
    newValues: slot
  })
  res.json({ slot })
})
