// إرسال فعلي عبر WhatsApp Business Cloud API (Meta) — منفصل تماماً عن رابط wa.me اليدوي
// الموجود في لوحة التحكم (OrderDrawer)، اللي بيفضل شغال دايماً حتى لو الـ API مش متصل.
// بيانات الاعتماد بتيجي من متغيرات بيئة السيرفر فقط (زي Cloudinary في imageStorageService.ts)
// — مش مخزّنة في قاعدة البيانات أبداً، وما بتتسجلش في أي log.
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { toWhatsAppInternational, isValidEgyptianMobile } from '../phone.js'
import { publicOrigin } from '../publicUrl.js'
import { logEvent, logWarn } from '../logger.js'

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
  // null لإرسال آلي بحت (تأكيد طلب تلقائي، بدون فاعل بشري) — إرسال يدوي من لوحة التحكم
  // لازم يفضل يمرر معرّف الأدمن الفعلي زي ما كان دايماً.
  createdByUserId: string | null
  // تصنيف نوع الإشعار (مثال: 'order_confirmation') — يُستخدم بس لمنع الإرسال التلقائي
  // المكرر لنفس الطلب (راجع hasSentNotification)، مش قيد فريد في قاعدة البيانات؛ الإرسال
  // اليدوي من الأدمن مش محتاج يمرره أصلاً (يفضل NULL، بلا أي قيد على تكراره).
  notificationType?: string | null
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
      `INSERT INTO whatsapp_messages (id, order_id, template_id, to_number, body, status, provider_message_id, created_by_user_id, notification_type)
       VALUES ($1, $2, $3, $4, $5, 'sent', $6, $7, $8)`,
      [id, input.orderId ?? null, input.templateId ?? null, input.toNumber, input.body, result.providerMessageId, input.createdByUserId, input.notificationType ?? null]
    )
    return { ok: true, sent: true, messageId: id, providerMessageId: result.providerMessageId }
  }

  await pool.query(
    `INSERT INTO whatsapp_messages (id, order_id, template_id, to_number, body, status, error, created_by_user_id, notification_type)
     VALUES ($1, $2, $3, $4, $5, 'failed', $6, $7, $8)`,
    [id, input.orderId ?? null, input.templateId ?? null, input.toNumber, input.body, result.error, input.createdByUserId, input.notificationType ?? null]
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
  notificationType: string | null
  createdAt: string
}

export async function listWhatsAppMessagesForOrder(orderId: string): Promise<WhatsAppMessageLogRow[]> {
  const { rows } = await pool.query<WhatsAppMessageLogRow>(
    `SELECT id, order_id as "orderId", template_id as "templateId", to_number as "toNumber", body,
            status, provider_message_id as "providerMessageId", error, notification_type as "notificationType", created_at as "createdAt"
     FROM whatsapp_messages WHERE order_id = $1 ORDER BY created_at DESC`,
    [orderId]
  )
  return rows
}

// هل الطلب ده اتبعتله تأكيد آلي ناجح من قبل بالفعل؟ بتُستخدم قبل أي محاولة إرسال تلقائي
// (مش الإرسال اليدوي من الأدمن، اللي بيتخطى الفحص ده عمداً — راجع resend في adminWhatsapp.ts)
// عشان إعادة محاولة الـ checkout أو استرجاع مفتاح idempotency ما يبعتوش نفس التأكيد مرتين.
export async function hasSentNotification(orderId: string, notificationType: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM whatsapp_messages WHERE order_id = $1 AND notification_type = $2 AND status = 'sent' LIMIT 1`,
    [orderId, notificationType]
  )
  return !!rows[0]
}

const ORDER_CONFIRMATION_CATEGORY = 'order_confirmation'
const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
]

// تنسيق تاريخ بسيط بأرقام غربية إجبارياً — عمداً مش بنستخدم toLocaleDateString('ar-...')
// هنا لأنها بترجع أرقام هندية-عربية (١٢٣) حسب بيانات ICU، وده ممنوع تماماً في هذا المشروع.
function formatArabicDateWesternDigits(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return isoDate
  return `${day} ${ARABIC_MONTHS[month - 1] ?? ''} ${year}`
}

export interface OrderConfirmationInput {
  orderId: string
  orderNumber: string
  customerName: string
  customerMobile: string
  customerAddress: string
  paymentMethod: string
  total: number
  deliveryDate: string | null
  deliverySlotId: string
  guestTrackingToken: string | null
}

async function resolveDeliverySlotLabel(slotId: string): Promise<string> {
  const { rows } = await pool.query<{ label: string }>('SELECT label FROM delivery_slots WHERE id = $1', [slotId])
  return rows[0]?.label ?? slotId
}

function buildTrackingUrl(orderNumber: string, guestTrackingToken: string | null): string {
  const base = `${publicOrigin()}/track/${encodeURIComponent(orderNumber)}`
  return guestTrackingToken ? `${base}?t=${encodeURIComponent(guestTrackingToken)}` : base
}

// نقطة الدمج مع إنشاء الطلب — بتتنفّذ بعد الـ commit الفعلي (راجع استدعاءها في
// orderService.createOrder)، ومصمّمة عمداً عشان أبداً ما ترمي استثناء لفوق: أي فشل (عدم
// إعداد، قالب مفقود، خطأ مزوّد، خطأ شبكة) بيتسجّل ويترجع بهدوء، الطلب نفسه فضل ناجح فعلاً
// قبل ما الدالة دي حتى تتنادى. force=true (اللي بيستخدمها إعادة الإرسال اليدوي من الأدمن)
// بتتخطى فحص "اتبعت قبل كده" — إعادة إرسال متعمّدة من الأدمن مش "تكرار غير مقصود".
export async function sendOrderConfirmationWhatsApp(order: OrderConfirmationInput, force = false): Promise<void> {
  try {
    if (!whatsappConfigured) return
    if (!force && await hasSentNotification(order.orderId, ORDER_CONFIRMATION_CATEGORY)) return

    const { rows: templateRows } = await pool.query<{ id: string; content: string }>(
      `SELECT id, content FROM whatsapp_templates WHERE category = $1 AND active = 1 ORDER BY created_at ASC LIMIT 1`,
      [ORDER_CONFIRMATION_CATEGORY]
    )
    const template = templateRows[0]
    if (!template) {
      logWarn('whatsapp_order_confirmation_template_missing', { orderId: order.orderId })
      return
    }

    const slotLabel = await resolveDeliverySlotLabel(order.deliverySlotId)
    const body = renderWhatsAppTemplate(template.content, {
      customerName: order.customerName,
      orderNumber: order.orderNumber,
      orderTotal: order.total.toFixed(2),
      paymentMethod: order.paymentMethod === 'COD' ? 'الدفع عند الاستلام' : order.paymentMethod,
      deliveryDate: order.deliveryDate ? formatArabicDateWesternDigits(order.deliveryDate) : 'أقرب موعد متاح',
      deliverySlot: slotLabel,
      customerAddress: order.customerAddress,
      trackingUrl: buildTrackingUrl(order.orderNumber, order.guestTrackingToken)
    })

    const result = await sendWhatsAppMessage({
      toNumber: order.customerMobile,
      body,
      orderId: order.orderId,
      templateId: template.id,
      createdByUserId: null,
      notificationType: ORDER_CONFIRMATION_CATEGORY
    })

    if (result.ok && result.sent) {
      logEvent('whatsapp_order_confirmation_sent', { orderId: order.orderId, orderNumber: order.orderNumber })
    } else if (result.ok && !result.sent) {
      logWarn('whatsapp_order_confirmation_failed', { orderId: order.orderId, error: result.error })
    }
  } catch (err) {
    logWarn('whatsapp_order_confirmation_error', { orderId: order.orderId, error: err instanceof Error ? err.message : 'unknown_error' })
  }
}
