import crypto from 'node:crypto'
import { pool } from '../db.js'
import { logEvent, logWarn } from '../logger.js'

const APP_SECRET = process.env.WHATSAPP_APP_SECRET
const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN

export const whatsappWebhookConfigured = !!(APP_SECRET && VERIFY_TOKEN)

export function verifyWebhookVerifyToken(mode: unknown, token: unknown): boolean {
  return VERIFY_TOKEN !== undefined && mode === 'subscribe' && token === VERIFY_TOKEN
}

// توقيع Meta (X-Hub-Signature-256) بيتحسب على البايتات الخام لجسم الطلب بالظبط — أي
// إعادة تسلسل (JSON.stringify(req.body)) ممكن يختلف عن البايتات الأصلية (ترتيب حقول،
// مسافات، ترميز) ويكسر التحقق حتى لو الطلب حقيقي فعلاً. لازم rawBody فعلياً، مش re-serialize.
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!APP_SECRET || !signatureHeader) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expected)
  const actualBuf = Buffer.from(signatureHeader)
  if (expectedBuf.length !== actualBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, actualBuf)
}

type MetaStatus = 'sent' | 'delivered' | 'read' | 'failed'
const KNOWN_STATUSES: readonly string[] = ['sent', 'delivered', 'read', 'failed']

interface MetaStatusEntry {
  id?: string
  status?: string
  timestamp?: string
  recipient_id?: string
  errors?: { code?: number; title?: string }[]
}

// بنية الـ payload كاملة موصوفة في توثيق Meta (WhatsApp Cloud API webhooks) — الحقول اللي
// مش مهتمين بيها هنا (messages الواردة من العميل، contacts...) بتتجاهل بهدوء لأننا مفيش عندنا
// أي ميزة محادثة ثنائية الاتجاه حالياً، مش لأنها خطأ.
interface MetaWebhookPayload {
  entry?: {
    changes?: {
      value?: {
        statuses?: MetaStatusEntry[]
      }
    }[]
  }[]
}

function extractStatusEntries(payload: unknown): MetaStatusEntry[] {
  const p = payload as MetaWebhookPayload
  const entries: MetaStatusEntry[] = []
  for (const entry of p?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const status of change?.value?.statuses ?? []) {
        entries.push(status)
      }
    }
  }
  return entries
}

// كل حدث بيتسجّل في السجل append-only أولاً (ON CONFLICT DO NOTHING — حماية من إعادة تسليم
// Meta لنفس الحدث)، وبعدين whatsapp_messages.delivery_status بيتحدّث بس لو الحدث ده أحدث
// فعلياً (بمقارنة event_timestamp نفسه، مش وقت وصول الطلب) من آخر حالة مسجّلة — Meta مش
// دايماً بتضمن ترتيب توصيل الـ webhooks نفسها.
export async function processStatusWebhookPayload(payload: unknown): Promise<{ processed: number; skipped: number }> {
  const entries = extractStatusEntries(payload)
  let processed = 0
  let skipped = 0

  for (const entry of entries) {
    if (!entry.id || !entry.status || !entry.timestamp || !KNOWN_STATUSES.includes(entry.status)) {
      skipped++
      continue
    }
    const status = entry.status as MetaStatus
    const eventTimestamp = new Date(Number(entry.timestamp) * 1000)
    if (Number.isNaN(eventTimestamp.getTime())) { skipped++; continue }

    const error = entry.errors?.[0]
    const { rowCount } = await pool.query(
      `INSERT INTO whatsapp_message_status_events
         (id, provider_message_id, status, event_timestamp, recipient_wa_id, error_code, error_title, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (provider_message_id, status, event_timestamp) DO NOTHING`,
      [crypto.randomUUID(), entry.id, status, eventTimestamp.toISOString(), entry.recipient_id ?? null, error?.code?.toString() ?? null, error?.title ?? null, JSON.stringify(entry)]
    )
    if (rowCount === 0) { skipped++; continue }

    await pool.query(
      `UPDATE whatsapp_messages
       SET delivery_status = $1, delivery_status_updated_at = $2
       WHERE provider_message_id = $3
         AND (delivery_status_updated_at IS NULL OR delivery_status_updated_at < $2)`,
      [status, eventTimestamp.toISOString(), entry.id]
    )
    processed++
  }

  if (skipped > 0) logWarn('whatsapp_webhook_entries_skipped', { skipped, total: entries.length })
  logEvent('whatsapp_webhook_processed', { processed, skipped })
  return { processed, skipped }
}
