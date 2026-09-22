import crypto from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, withTransaction } from '../db.js'
import { logEvent, logWarn } from '../logger.js'

export type PriceScheduleStatus = 'pending' | 'applied' | 'cancelled' | 'conflict'

export interface PriceScheduleRow {
  id: string
  productId: string | null
  variantId: string | null
  newPrice: number
  newOldPrice: number | null
  expectedCurrentPrice: number
  startsAt: string
  status: PriceScheduleStatus
  appliedAt: string | null
  createdBy: string | null
  createdAt: string
}

const SELECT_SCHEDULE = `
  SELECT id, product_id as "productId", variant_id as "variantId", new_price as "newPrice",
         new_old_price as "newOldPrice", expected_current_price as "expectedCurrentPrice",
         starts_at as "startsAt", status, applied_at as "appliedAt", created_by as "createdBy", created_at as "createdAt"
  FROM product_price_schedules
`

export interface CreateScheduleInput {
  productId: string | null
  variantId: string | null
  newPrice: number
  newOldPrice: number | null
  startsAt: string
}

export type CreateScheduleError = 'target_not_found' | 'starts_at_in_past'

async function findCurrentPrice(productId: string | null, variantId: string | null): Promise<number | null> {
  if (variantId) {
    const { rows } = await pool.query<{ price: number }>('SELECT price FROM product_variants WHERE id = $1', [variantId])
    return rows[0]?.price ?? null
  }
  const { rows } = await pool.query<{ price: number }>('SELECT price FROM products WHERE id = $1', [productId])
  return rows[0]?.price ?? null
}

export async function createPriceSchedule(
  input: CreateScheduleInput, adminUserId: string
): Promise<{ ok: true, schedule: PriceScheduleRow } | { ok: false, error: CreateScheduleError }> {
  if (new Date(input.startsAt).getTime() <= Date.now()) return { ok: false, error: 'starts_at_in_past' }

  const currentPrice = await findCurrentPrice(input.productId, input.variantId)
  if (currentPrice === null) return { ok: false, error: 'target_not_found' }

  const id = `pxsch_${crypto.randomBytes(10).toString('hex')}`
  await pool.query(
    `INSERT INTO product_price_schedules (id, product_id, variant_id, new_price, new_old_price, expected_current_price, starts_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, input.productId, input.variantId, input.newPrice, input.newOldPrice, currentPrice, input.startsAt, adminUserId]
  )

  const { rows } = await pool.query<PriceScheduleRow>(`${SELECT_SCHEDULE} WHERE id = $1`, [id])
  return { ok: true, schedule: rows[0] }
}

export async function listPriceSchedules(params: { productId?: string, status?: PriceScheduleStatus } = {}): Promise<PriceScheduleRow[]> {
  const conditions: string[] = []
  const values: unknown[] = []
  if (params.productId) {
    values.push(params.productId)
    conditions.push(`product_id = $${values.length}`)
  }
  if (params.status) {
    values.push(params.status)
    conditions.push(`status = $${values.length}`)
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await pool.query<PriceScheduleRow>(`${SELECT_SCHEDULE} ${whereClause} ORDER BY starts_at ASC`, values)
  return rows
}

// إلغاء جدولة — بس لو لسه pending (لم تُنفَّذ فعلياً). جدولة اتنفذت أو اتلغت أو فيها تعارض
// فعلاً ما بترجعش لـ pending تاني — سجل ثابت لما حصل فعلياً وقتها.
export async function cancelPriceSchedule(id: string): Promise<boolean> {
  const result = await pool.query(`UPDATE product_price_schedules SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`, [id])
  return (result.rowCount ?? 0) > 0
}

interface DueScheduleRow {
  id: string
  productId: string | null
  variantId: string | null
  newPrice: number
  newOldPrice: number | null
  expectedCurrentPrice: number
}

// بتتنفّذ جوه معاملة واحدة لكل جدولة — قفل الصف الفعلي (منتج أو متغير) بعد قفل صف الجدولة
// نفسه، فحص التعارض (السعر الحالي لسه زي وقت الإنشاء)، تحديث السعر، وتسجيل صف جديد في
// product_price_history (نفس آلية bulkPricingService.ts بالظبط، بمصدر 'scheduled_price').
async function applyOneSchedule(client: PoolClient, schedule: DueScheduleRow): Promise<'applied' | 'conflict'> {
  const table = schedule.variantId ? 'product_variants' : 'products'
  const targetId = schedule.variantId ?? schedule.productId!
  const { rows } = await client.query<{ price: number }>(`SELECT price FROM ${table} WHERE id = $1 FOR UPDATE`, [targetId])
  const current = rows[0]

  if (!current || current.price !== schedule.expectedCurrentPrice) {
    await client.query(`UPDATE product_price_schedules SET status = 'conflict' WHERE id = $1`, [schedule.id])
    return 'conflict'
  }

  await client.query(`UPDATE ${table} SET price = $1, old_price = $2 WHERE id = $3`, [schedule.newPrice, schedule.newOldPrice, targetId])
  await client.query(
    `INSERT INTO product_price_history (product_id, variant_id, old_price, new_price, old_old_price, new_old_price, source)
     VALUES ($1,$2,$3,$4,NULL,$5,'scheduled_price')`,
    [schedule.variantId ? null : targetId, schedule.variantId, current.price, schedule.newPrice, schedule.newOldPrice]
  )
  await client.query(`UPDATE product_price_schedules SET status = 'applied', applied_at = now() WHERE id = $1`, [schedule.id])
  return 'applied'
}

// نفس نمط runLoyaltyExpiryBatch بالظبط — دفعة محدودة الحجم، FOR UPDATE SKIP LOCKED عشان
// أي تشغيلتين متزامنتين (سباق cron نظرياً) ما يحاولوش ينفذوا نفس الجدولة مرتين، وبيرجّع عدد
// الصفوف اللي عولجت فعلياً (سواء applied أو conflict) عشان الكولر يقرر يكمل الحلقة ولا لأ.
export async function runApplyScheduledBatch(batchSize: number): Promise<{ applied: number, conflicts: number }> {
  let applied = 0
  let conflicts = 0
  await withTransaction(async client => {
    const { rows } = await client.query<DueScheduleRow>(
      `SELECT id, product_id as "productId", variant_id as "variantId", new_price as "newPrice",
              new_old_price as "newOldPrice", expected_current_price as "expectedCurrentPrice"
       FROM product_price_schedules
       WHERE status = 'pending' AND starts_at <= now()
       ORDER BY starts_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [batchSize]
    )
    for (const schedule of rows) {
      const result = await applyOneSchedule(client, schedule)
      if (result === 'applied') {
        applied++
        logEvent('price_schedule_applied', { scheduleId: schedule.id, productId: schedule.productId, variantId: schedule.variantId, newPrice: schedule.newPrice })
      } else {
        conflicts++
        logWarn('price_schedule_conflict', { scheduleId: schedule.id, productId: schedule.productId, variantId: schedule.variantId, expected: schedule.expectedCurrentPrice })
      }
    }
  })
  return { applied, conflicts }
}
