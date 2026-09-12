// إرسال فعلي عبر WhatsApp Business Cloud API (Meta) — منفصل تماماً عن رابط wa.me اليدوي
// الموجود في لوحة التحكم (OrderDrawer)، اللي بيفضل شغال دايماً حتى لو الـ API مش متصل.
// بيانات الاعتماد بتيجي من متغيرات بيئة السيرفر فقط (زي Cloudinary في imageStorageService.ts)
// — مش مخزّنة في قاعدة البيانات أبداً، وما بتتسجلش في أي log.
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { toWhatsAppInternational, isValidEgyptianMobile } from '../phone.js'

const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const API_VERSION = process.env.WHATSAPP_API_VERSION ?? 'v21.0'

export const whatsappConfigured = !!(ACCESS_TOKEN && PHONE_NUMBER_ID)

export interface WhatsAppTemplateRow {
  id: string
  name: string
  category: string
  content: string
  active: boolean
  createdAt: string
  updatedAt: string
}

interface TemplateDbRow {
  id: string; name: string; category: string; content: string; active: number
  createdAt: string; updatedAt: string
}

function serializeTemplate(row: TemplateDbRow): WhatsAppTemplateRow {
  return { ...row, active: !!row.active }
}

export async function listWhatsAppTemplates(): Promise<WhatsAppTemplateRow[]> {
  const { rows } = await pool.query<TemplateDbRow>(
    `SELECT id, name, category, content, active, created_at as "createdAt", updated_at as "updatedAt"
     FROM whatsapp_templates ORDER BY created_at ASC`
  )
  return rows.map(serializeTemplate)
}

export interface WhatsAppTemplateInput {
  name: string
  category: string
  content: string
  active: boolean
}

export async function createWhatsAppTemplate(input: WhatsAppTemplateInput): Promise<WhatsAppTemplateRow> {
  const id = 'wa-tpl-' + crypto.randomBytes(6).toString('hex')
  const { rows } = await pool.query<TemplateDbRow>(
    `INSERT INTO whatsapp_templates (id, name, category, content, active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, category, content, active, created_at as "createdAt", updated_at as "updatedAt"`,
    [id, input.name, input.category, input.content, input.active ? 1 : 0]
  )
  return serializeTemplate(rows[0])
}

export async function updateWhatsAppTemplate(id: string, input: WhatsAppTemplateInput): Promise<WhatsAppTemplateRow | null> {
  const { rows } = await pool.query<TemplateDbRow>(
    `UPDATE whatsapp_templates SET name=$2, category=$3, content=$4, active=$5, updated_at=now()
     WHERE id=$1
     RETURNING id, name, category, content, active, created_at as "createdAt", updated_at as "updatedAt"`,
    [id, input.name, input.category, input.content, input.active ? 1 : 0]
  )
  return rows[0] ? serializeTemplate(rows[0]) : null
}

// استبدال {{متغير}} بقيمته الفعلية — أي متغير مش موجود في القالب بيتجاهل، وأي {{متغير}}
// في المحتوى مالوش قيمة ممرّرة بيفضل زي ما هو (عشان الأدمن يلاحظ القالب ناقص بيانات).
export function renderWhatsAppTemplate(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] ?? match)
}

type SendResult =
  | { success: true; providerMessageId: string }
  | { success: false; error: string }

async function callWhatsAppCloudApi(toNumber: string, body: string): Promise<SendResult> {
  if (!whatsappConfigured) return { success: false, error: 'whatsapp_not_configured' }

  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toNumber,
        type: 'text',
        text: { body }
      })
    })
    const data = await res.json().catch(() => null) as { messages?: { id: string }[]; error?: { message?: string } } | null
    if (!res.ok || !data?.messages?.[0]?.id) {
      return { success: false, error: data?.error?.message ?? `http_${res.status}` }
    }
    return { success: true, providerMessageId: data.messages[0].id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'network_error' }
  }
}

export interface SendWhatsAppMessageInput {
  toNumber: string
  body: string
  orderId?: string | null
  templateId?: string | null
  createdByUserId: string
}

export type SendWhatsAppMessageResult =
  | { ok: false; reason: 'invalid_number' | 'whatsapp_not_configured' }
  | { ok: true; sent: true; messageId: string; providerMessageId: string }
  | { ok: true; sent: false; messageId: string; error: string }

// كل محاولة إرسال حقيقية (نجحت أو فشلت) بتتسجّل في whatsapp_messages — عدا حالة عدم
// الإعداد أصلاً (whatsapp_not_configured)، اللي مالهاش معنى تتسجل كمحاولة إرسال فعلية.
export async function sendWhatsAppMessage(input: SendWhatsAppMessageInput): Promise<SendWhatsAppMessageResult> {
  if (!isValidEgyptianMobile(input.toNumber)) return { ok: false, reason: 'invalid_number' }
  if (!whatsappConfigured) return { ok: false, reason: 'whatsapp_not_configured' }

  const toInternational = toWhatsAppInternational(input.toNumber)
  const result = await callWhatsAppCloudApi(toInternational, input.body)
  const id = crypto.randomUUID()

  if (result.success) {
    await pool.query(
      `INSERT INTO whatsapp_messages (id, order_id, template_id, to_number, body, status, provider_message_id, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, 'sent', $6, $7)`,
      [id, input.orderId ?? null, input.templateId ?? null, input.toNumber, input.body, result.providerMessageId, input.createdByUserId]
    )
    return { ok: true, sent: true, messageId: id, providerMessageId: result.providerMessageId }
  }

  await pool.query(
    `INSERT INTO whatsapp_messages (id, order_id, template_id, to_number, body, status, error, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, 'failed', $6, $7)`,
    [id, input.orderId ?? null, input.templateId ?? null, input.toNumber, input.body, result.error, input.createdByUserId]
  )
  return { ok: true, sent: false, messageId: id, error: result.error }
}

export interface WhatsAppMessageLogRow {
  id: string
  orderId: string | null
  templateId: string | null
  toNumber: string
  body: string
  status: 'sent' | 'failed'
  providerMessageId: string | null
  error: string | null
  createdAt: string
}

export async function listWhatsAppMessagesForOrder(orderId: string): Promise<WhatsAppMessageLogRow[]> {
  const { rows } = await pool.query<WhatsAppMessageLogRow>(
    `SELECT id, order_id as "orderId", template_id as "templateId", to_number as "toNumber", body,
            status, provider_message_id as "providerMessageId", error, created_at as "createdAt"
     FROM whatsapp_messages WHERE order_id = $1 ORDER BY created_at DESC`,
    [orderId]
  )
  return rows
}
