import { Router } from 'express'
import {
  listActiveDeliveryZones, listActiveDeliverySlotsWithAvailability,
  getDeliveryCalendarSettings, isDeliveryDateOpen
} from '../services/deliveryService.js'
import { pool } from '../db.js'
import { todayInCairo, nextCalendarDates, isoWeekdayOf } from '../cairoDate.js'

export const deliveryRouter = Router()

deliveryRouter.get('/zones', async (_req, res) => {
  const zones = await listActiveDeliveryZones()
  res.json({ zones: zones.map(z => ({ governorate: z.governorate, deliveryFee: z.deliveryFee })) })
})

// راجع للتوافق مع أي عميل قديم بيسأل عن قايمة المواعيد لوحدها (من غير تاريخ) — بيتحسب على
// سعة "النهاردة" بتوقيت القاهرة كتقريب. الشاشة الفعلية للدفع بقت تستخدم /availability تحت.
deliveryRouter.get('/slots', async (_req, res) => {
  const slots = await listActiveDeliverySlotsWithAvailability(todayInCairo())
  res.json({ slots: slots.map(s => ({ id: s.id, label: s.label, note: s.note, available: s.available })) })
})

const MAX_REQUESTABLE_DAYS = 30

// تقويم توصيل حقيقي: لكل يوم من الأيام القادمة (افتراضياً delivery_days_ahead من إعدادات
// المتجر)، بيرجع حالة كل ميعاد نشط (متاح/ممتلئ) والسعة المتبقية له في نفس اليوم ده تحديداً.
// ده بس للعرض/تحسين تجربة الاستخدام — الفحص الحقيقي والنهائي بيحصل تاني وقت إنشاء الطلب.
deliveryRouter.get('/availability', async (req, res) => {
  const { daysAhead } = await getDeliveryCalendarSettings()
  const requestedDays = Number(req.query.days)
  const days = Number.isInteger(requestedDays) && requestedDays > 0 ? Math.min(requestedDays, MAX_REQUESTABLE_DAYS) : daysAhead

  const dates = nextCalendarDates(todayInCairo(), days)
  const result = await Promise.all(dates.map(async date => {
    const open = await isDeliveryDateOpen(pool, date)
    const slots = open ? await listActiveDeliverySlotsWithAvailability(date) : []
    return {
      date,
      weekday: isoWeekdayOf(date),
      open,
      slots: slots.map(s => ({ id: s.id, label: s.label, note: s.note, available: s.available, remainingCapacity: s.remainingCapacity }))
    }
  }))

  res.json({ days: result })
})
