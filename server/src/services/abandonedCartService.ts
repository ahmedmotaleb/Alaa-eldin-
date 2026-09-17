import { pool } from '../db.js'
import { getNotificationPreferences, sendPushToUser } from './pushService.js'

// نفس مبدأ ثابت بسيط بدل إعداد إداري إضافي (زي STUCK_ORDER_HOURS في alertsService.ts) —
// مفيش داعي لواجهة إعدادات منفصلة لرقم بيتغيّر نادراً جداً.
const ABANDONED_CART_HOURS = 24

export interface CartSnapshotItem {
  productId: string
  variantId?: string
  quantity: number
}

// بيتسجّل بس للعميل المسجّل دخول — الزائر (بدون حساب) مفيش أي وسيلة اتصال بيه أصلاً
// (لا اشتراك Push ولا واتساب مرتبط)، فمفيش فايدة نخزّن سلته. تحديث السلة بيصفّر
// reminder_sent_at دايماً — تغيير حقيقي في السلة يعني "لسه العميل شغّال عليها"، مش مهجورة.
export async function upsertCartSnapshot(userId: string, items: CartSnapshotItem[]): Promise<void> {
  if (items.length === 0) {
    await clearCartSnapshot(userId)
    return
  }
  await pool.query(
    `INSERT INTO cart_snapshots (user_id, items, updated_at, reminder_sent_at)
     VALUES ($1, $2::jsonb, now(), NULL)
     ON CONFLICT (user_id) DO UPDATE SET items = $2::jsonb, updated_at = now(), reminder_sent_at = NULL`,
    [userId, JSON.stringify(items)]
  )
}

export async function clearCartSnapshot(userId: string): Promise<void> {
  await pool.query('DELETE FROM cart_snapshots WHERE user_id = $1', [userId])
}

interface AbandonedCartCandidate {
  userId: string
  items: CartSnapshotItem[]
  updatedAt: string
}

async function findAbandonedCartCandidates(): Promise<AbandonedCartCandidate[]> {
  const { rows } = await pool.query<AbandonedCartCandidate>(
    `SELECT user_id as "userId", items, updated_at as "updatedAt" FROM cart_snapshots
     WHERE reminder_sent_at IS NULL AND updated_at < now() - interval '${ABANDONED_CART_HOURS} hours'`
  )
  return rows
}

export interface AbandonedCartReminderStats {
  reminded: number
  skippedConverted: number
  skippedPreference: number
}

// مصمّمة عشان تتشغّل من سكريبت مستقل (راجع sendAbandonedCartReminders.ts) عن طريق جدولة
// خارجية (Railway cron job) — مفيش scheduler جوه التطبيق نفسه، نفس مبدأ cleanup.ts بالظبط.
export async function sendAbandonedCartReminders(): Promise<AbandonedCartReminderStats> {
  const candidates = await findAbandonedCartCandidates()
  const stats: AbandonedCartReminderStats = { reminded: 0, skippedConverted: 0, skippedPreference: 0 }

  for (const candidate of candidates) {
    // لو العميل عمل طلب حقيقي بعد آخر تحديث لسلته، يبقى غالباً كمّل الشراء (أو غيّر رأيه) —
    // السلة القديمة بقت غير ذات صلة، تتمسح من غير أي تذكير مزعج لطلب اتنفّذ بالفعل.
    const { rows: recentOrderRows } = await pool.query(
      'SELECT 1 FROM orders WHERE user_id = $1 AND created_at > $2 LIMIT 1',
      [candidate.userId, candidate.updatedAt]
    )
    if (recentOrderRows[0]) {
      await clearCartSnapshot(candidate.userId)
      stats.skippedConverted++
      continue
    }

    const prefs = await getNotificationPreferences(candidate.userId)
    if (!prefs.promotions) {
      stats.skippedPreference++
      continue
    }

    const itemCount = candidate.items.reduce((sum, item) => sum + item.quantity, 0)
    await sendPushToUser(candidate.userId, {
      title: 'نسيت حاجة في سلتك؟',
      body: `لسه عندك ${itemCount} صنف في السلة — كمّل طلبك قبل ما ينفد المخزون`,
      url: '/cart'
    })
    await pool.query('UPDATE cart_snapshots SET reminder_sent_at = now() WHERE user_id = $1', [candidate.userId])
    stats.reminded++
  }

  return stats
}
