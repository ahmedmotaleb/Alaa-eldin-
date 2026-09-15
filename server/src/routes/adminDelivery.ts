import { Router } from 'express'
import { requireAdmin, requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import {
  listAllDeliveryZones, updateDeliveryZone,
  listAllDeliverySlots, createDeliverySlot, updateDeliverySlot,
  getDeliveryCalendarSettings, updateDeliveryCalendarSettings,
  listDateOverridesInRange, upsertDateOverride, deleteDateOverride,
  listSlotDateCapacityOverridesInRange, setSlotDateCapacity
} from '../services/deliveryService.js'
import { isValidCalendarDateString, todayInCairo, addCalendarDays } from '../cairoDate.js'

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

// --- تقويم التوصيل (Phase 94) ---

const MAX_DAYS_AHEAD = 60

function parseRangeQuery(req: { query: Record<string, unknown> }): { from: string, to: string } | null {
  const from = typeof req.query.from === 'string' && isValidCalendarDateString(req.query.from) ? req.query.from : todayInCairo()
  const to = typeof req.query.to === 'string' && isValidCalendarDateString(req.query.to) ? req.query.to : addCalendarDays(from, MAX_DAYS_AHEAD)
  if (to < from) return null
  return { from, to }
}

adminDeliveryRouter.get('/calendar-settings', requirePermission('delivery.manage'), async (_req, res) => {
  res.json({ settings: await getDeliveryCalendarSettings() })
})

adminDeliveryRouter.patch('/calendar-settings', requirePermission('delivery.manage'), async (req, res) => {
  const b = req.body as Record<string, unknown>
  const daysAhead = Number(b?.daysAhead)
  const closedWeekdays = Array.isArray(b?.closedWeekdays) ? b.closedWeekdays.filter((n): n is number => typeof n === 'number') : undefined
  if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > MAX_DAYS_AHEAD || !closedWeekdays || closedWeekdays.some(n => n < 1 || n > 7)) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const before = await getDeliveryCalendarSettings()
  const settings = await updateDeliveryCalendarSettings({ daysAhead, closedWeekdays })
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'delivery_calendar_settings_updated',
    entityType: 'delivery_calendar_settings',
    entityId: '1',
    oldValues: before,
    newValues: settings
  })
  res.json({ settings })
})

adminDeliveryRouter.get('/date-overrides', requirePermission('delivery.manage'), async (req, res) => {
  const range = parseRangeQuery(req)
  if (!range) { res.status(400).json({ error: 'invalid_range' }); return }
  res.json({ overrides: await listDateOverridesInRange(range.from, range.to) })
})

adminDeliveryRouter.put('/date-overrides/:date', requirePermission('delivery.manage'), async (req, res) => {
  const date = String(req.params.date)
  const b = req.body as Record<string, unknown>
  if (!isValidCalendarDateString(date) || typeof b?.active !== 'boolean' || typeof b?.notes !== 'string') {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const override = await upsertDateOverride(date, b.active, b.notes.trim())
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'delivery_date_override_set',
    entityType: 'delivery_date_override',
    entityId: date,
    newValues: override
  })
  res.json({ override })
})

adminDeliveryRouter.delete('/date-overrides/:date', requirePermission('delivery.manage'), async (req, res) => {
  const date = String(req.params.date)
  if (!isValidCalendarDateString(date)) { res.status(400).json({ error: 'invalid_date' }); return }

  const removed = await deleteDateOverride(date)
  if (!removed) { res.status(404).json({ error: 'override_not_found' }); return }

  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'delivery_date_override_removed',
    entityType: 'delivery_date_override',
    entityId: date
  })
  res.status(204).end()
})

adminDeliveryRouter.get('/slot-capacity', requirePermission('delivery.manage'), async (req, res) => {
  const range = parseRangeQuery(req)
  if (!range) { res.status(400).json({ error: 'invalid_range' }); return }
  res.json({ overrides: await listSlotDateCapacityOverridesInRange(range.from, range.to) })
})

// maxOrders = null بيشيل السعة الاستثنائية ويرجّع الميعاد لسعته الافتراضية.
adminDeliveryRouter.put('/slot-capacity', requirePermission('delivery.manage'), async (req, res) => {
  const b = req.body as Record<string, unknown>
  const date = typeof b?.date === 'string' ? b.date : ''
  const slotId = typeof b?.slotId === 'string' ? b.slotId.trim() : ''
  const maxOrders = b?.maxOrders === null ? null : Number(b?.maxOrders)
  if (
    !isValidCalendarDateString(date) || !slotId ||
    (maxOrders !== null && (!Number.isInteger(maxOrders) || maxOrders < 0))
  ) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  await setSlotDateCapacity(date, slotId, maxOrders)
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: 'delivery_slot_date_capacity_set',
    entityType: 'delivery_slot_date_capacity',
    entityId: `${date}:${slotId}`,
    newValues: { date, slotId, maxOrders }
  })
  res.status(204).end()
})
