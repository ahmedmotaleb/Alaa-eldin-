// إرسال فعلي عبر WhatsApp Business Cloud API (Meta) — منفصل تماماً عن رابط wa.me اليدوي
// الموجود في لوحة التحكم (OrderDrawer)، اللي بيفضل شغال دايماً حتى لو الـ API مش متصل.
// بيانات الاعتماد بتيجي من متغيرات بيئة السيرفر فقط (زي Cloudinary في imageStorageService.ts)
// — مش مخزّنة في قاعدة البيانات أبداً، وما بتتسجلش في أي log.
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { toWhatsAppInternational, isValidEgyptianMobile } from '../phone.js'
import { publicOrigin } from '../publicUrl.js'
import { logEvent, logWarn } from '../logger.js'
import {
  claimAutomaticNotification, markNotificationSent, markNotificationFailed,
  listRetryableFailedNotifications, getAutomaticNotificationStatus,
  type NotificationDeliveryStatusRow, type NotificationFailureClass
} from './whatsappNotificationDeliveryService.js'

const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const API_VERSION = process.env.WHATSAPP_API_VERSION ?? 'v21.0'

export const whatsappConfigured = !!(ACCESS_TOKEN && PHONE_NUMBER_ID)

// اسم/لغة قالب تأكيد الطلب المعتمد من Meta — مُهيّأ من متغيرات بيئة السيرفر، مش قيمة
// مُختلقة أو ثابتة في الكود (راجع server/docs/WHATSAPP_ORDER_CONFIRMATION_TEMPLATE.md
// للمحتوى المطلوب اعتماده فعلياً في Meta Business Manager قبل ما الميزة دي تشتغل حقيقةً).
const ORDER_CONFIRMATION_TEMPLATE_NAME = process.env.WHATSAPP_ORDER_CONFIRMATION_TEMPLATE
const ORDER_CONFIRMATION_LANGUAGE = process.env.WHATSAPP_ORDER_CONFIRMATION_LANGUAGE ?? 'ar'

// "جاهز" هنا تحديداً معناها: نقدر نبني ونرسل رسالة قالب Meta فعلية لتأكيد الطلب. ده غير
// whatsappConfigured اللي بس معناها "نقدر نتصل بـ API أصلاً" (كافي للإرسال اليدوي بنص حر من
// لوحة التحكم، لكن مش كافي للتأكيد التلقائي من غير اسم قالب معتمد فعلياً).
export const whatsappOrderConfirmationReady = whatsappConfigured && !!ORDER_CONFIRMATION_TEMPLATE_NAME

export function getOrderConfirmationConfigStatus(): { apiConfigured: boolean; templateConfigured: boolean; templateName: string | null; language: string } {
  return {
    apiConfigured: whatsappConfigured,
    templateConfigured: !!ORDER_CONFIRMATION_TEMPLATE_NAME,
    templateName: ORDER_CONFIRMATION_TEMPLATE_NAME ?? null,
    language: ORDER_CONFIRMATION_LANGUAGE
  }
}

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

// المهلة لازم تفضل أقصر بكتير من إيجار ملكية الإشعار التلقائي (90 ثانية، راجع
// whatsappNotificationDeliveryService.ts) عشان الإيجار ميخلصش أثناء ما الطلب لسه بيتنفّذ فعلياً
// في الحالة الطبيعية — فشل هنا أبداً ما بيأثر على نجاح الطلب نفسه (راجع sendOrderConfirmationWhatsApp).
const PROVIDER_TIMEOUT_MS = 10_000

type SendResult =
  | { success: true; providerMessageId: string }
  | { success: false; error: string }

// نفس التصنيف المُستخدم في whatsappNotificationDeliveryService.ts (راجع تعليق
// NotificationFailureClass هناك) — بس بالاسم القديم هنا لتقليل حجم التعديل في باقي الملف:
// retryable: رد HTTP مؤقت مؤكد من Meta (429/5xx) — إعادة محاولة تلقائية مسموحة.
// permanent: أي رد HTTP آخر من Meta (توكن غلط، قالب غير موجود/غير معتمد، لغة/بارامترات غلط،
//   رقم وجهة غير صالح) — إعادة محاولة تلقائية ممنوعة، الخطأ مش هيتحل بإعادة المحاولة أصلاً.
// unknown: الطلب فشل قبل ما نستلم أي رد فعلي من Meta خالص (تايم آوت محلي أو خطأ شبكة) —
//   Meta ممكن تكون استلمت الرسالة الأصلية فعلاً، فإعادة محاولة تلقائية عليها ممنوعة عمداً
//   (خطر تأكيد مكرر فعلي للعميل) — مينفعش نعامله كفشل مؤقت عادي.
type ProviderErrorClass = NotificationFailureClass

interface TemplateSendResult {
  success: boolean
  providerMessageId?: string
  errorClass?: ProviderErrorClass
  error?: string
}

function classifyHttpStatus(status: number): ProviderErrorClass {
  if (status === 429 || status >= 500) return 'retryable'
  return 'permanent'
}

async function callWhatsAppCloudApi(toNumber: string, body: string): Promise<SendResult> {
  if (!whatsappConfigured) return { success: false, error: 'whatsapp_not_configured' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
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
      }),
      signal: controller.signal
    })
    const data = await res.json().catch(() => null) as { messages?: { id: string }[]; error?: { message?: string } } | null
    if (!res.ok || !data?.messages?.[0]?.id) {
      return { success: false, error: data?.error?.message ?? `http_${res.status}` }
    }
    return { success: true, providerMessageId: data.messages[0].id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'network_error' }
  } finally {
    clearTimeout(timeout)
  }
}

// شكل مكوّنات قالب Meta الرسمي (WhatsApp Cloud API) — body بارامترات نصية بالترتيب المطابق
// تماماً لترتيب {{1}}..{{n}} في القالب المعتمد، وbutton لبارامتر واحد ديناميكي (الجزء المتغيّر
// بس من رابط زرار URL ديناميكي مُسجَّل في Meta Business Manager — راجع توثيق القالب المطلوب
// في server/docs/WHATSAPP_ORDER_CONFIRMATION_TEMPLATE.md). لا نخترع أي حقل غير موثّق هنا.
export interface WhatsAppTemplateComponent {
  type: 'body' | 'button' | 'header'
  sub_type?: 'url' | 'quick_reply'
  index?: string
  parameters: { type: 'text'; text: string }[]
}

async function callWhatsAppCloudApiTemplate(
  toNumber: string, templateName: string, languageCode: string, components: WhatsAppTemplateComponent[]
): Promise<TemplateSendResult> {
  if (!whatsappConfigured) return { success: false, errorClass: 'permanent', error: 'whatsapp_not_configured' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
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
        type: 'template',
        template: { name: templateName, language: { code: languageCode }, components }
      }),
      signal: controller.signal
    })
    const data = await res.json().catch(() => null) as { messages?: { id: string }[]; error?: { message?: string } } | null
    if (!res.ok || !data?.messages?.[0]?.id) {
      return { success: false, errorClass: classifyHttpStatus(res.status), error: data?.error?.message ?? `http_${res.status}` }
    }
    return { success: true, providerMessageId: data.messages[0].id }
  } catch (err) {
    // فشل قبل استلام أي رد فعلي من Meta (تايم آوت أو خطأ شبكة) — نتيجة غير مؤكدة عمداً
    // (راجع تعليق ProviderErrorClass فوق)، مش فشل ولا نجاح قاطع.
    return { success: false, errorClass: 'unknown', error: err instanceof Error ? err.message : 'network_error' }
  } finally {
    clearTimeout(timeout)
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

export interface SendWhatsAppTemplateInput {
  toNumber: string
  templateName: string
  languageCode: string
  components: WhatsAppTemplateComponent[]
  // نص قابل للقراءة للعرض في لوحة التحكم/سجل whatsapp_messages فقط — مش المُرسل فعلياً
  // لـ Meta (اللي بيتبني حصراً من templateName/languageCode/components فوق). راجع تعليق
  // التمييز بين القالب الداخلي (Admin UX) وقالب Meta المعتمد في sendOrderConfirmationWhatsApp.
  previewBody: string
  orderId?: string | null
  createdByUserId: string | null
  notificationType?: string | null
}

export type SendWhatsAppTemplateResult =
  | { ok: false; reason: 'invalid_number' | 'whatsapp_not_configured' }
  | { ok: true; sent: true; messageId: string; providerMessageId: string }
  | { ok: true; sent: false; messageId: string; error: string; errorClass: ProviderErrorClass }

// النسخة المخصّصة لرسائل قالب Meta المعتمدة (type: "template") — مش نص حر. بتُستخدم حصراً
// من تأكيد الطلب التلقائي وإعادة الإرسال اليدوي لنفس التأكيد؛ باقي الإرسال اليدوي الحر
// (اختيار أي قالب داخلي/نص حر من صفحة الطلب في لوحة التحكم) يفضل يستخدم sendWhatsAppMessage
// فوق زي ما كان دايماً — مفيش داعي نجبر كل استخدامات واتساب الحالية على القوالب المعتمدة.
export async function sendWhatsAppTemplateMessage(input: SendWhatsAppTemplateInput): Promise<SendWhatsAppTemplateResult> {
  if (!isValidEgyptianMobile(input.toNumber)) return { ok: false, reason: 'invalid_number' }
  if (!whatsappConfigured) return { ok: false, reason: 'whatsapp_not_configured' }

  const toInternational = toWhatsAppInternational(input.toNumber)
  const result = await callWhatsAppCloudApiTemplate(toInternational, input.templateName, input.languageCode, input.components)
  const id = crypto.randomUUID()

  if (result.success) {
    await pool.query(
      `INSERT INTO whatsapp_messages (id, order_id, template_id, to_number, body, status, provider_message_id, created_by_user_id, notification_type)
       VALUES ($1, $2, NULL, $3, $4, 'sent', $5, $6, $7)`,
      [id, input.orderId ?? null, input.toNumber, input.previewBody, result.providerMessageId, input.createdByUserId, input.notificationType ?? null]
    )
    return { ok: true, sent: true, messageId: id, providerMessageId: result.providerMessageId! }
  }

  await pool.query(
    `INSERT INTO whatsapp_messages (id, order_id, template_id, to_number, body, status, error, created_by_user_id, notification_type)
     VALUES ($1, $2, NULL, $3, $4, 'failed', $5, $6, $7)`,
    [id, input.orderId ?? null, input.toNumber, input.previewBody, result.error, input.createdByUserId, input.notificationType ?? null]
  )
  return { ok: true, sent: false, messageId: id, error: result.error!, errorClass: result.errorClass! }
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
  // اتنيها من webhook حقيقي من Meta (sent/delivered/read/failed) — مش نفس status فوق (اللي
  // معناها بس "Meta API قبلت الطلب"). null يعني لسه مفيش أي حدث حالة حقيقي وصل بعد (إما
  // الـ webhook مش مُفعّل، أو Meta لسه ما بعتتش الحدث).
  deliveryStatus: string | null
  deliveryStatusUpdatedAt: string | null
}

export async function listWhatsAppMessagesForOrder(orderId: string): Promise<WhatsAppMessageLogRow[]> {
  const { rows } = await pool.query<WhatsAppMessageLogRow>(
    `SELECT id, order_id as "orderId", template_id as "templateId", to_number as "toNumber", body,
            status, provider_message_id as "providerMessageId", error, notification_type as "notificationType", created_at as "createdAt",
            delivery_status as "deliveryStatus", delivery_status_updated_at as "deliveryStatusUpdatedAt"
     FROM whatsapp_messages WHERE order_id = $1 ORDER BY created_at DESC`,
    [orderId]
  )
  return rows
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

// الجزء المتغيّر بس من رابط زرار URL الديناميكي (راجع تعليق WhatsAppTemplateComponent فوق) —
// Meta بتلحقه تلقائياً بآخر الرابط الأساسي الثابت المُسجَّل وقت اعتماد القالب في Business
// Manager (مثال: https://.../track/)، فناتج الرابط النهائي للعميل بيبقى مطابق لـ buildTrackingUrl
// فوق تماماً من غير ما نبعت رابط كامل كبارامتر (Meta ما بتقبلش كده أصلاً لأزرار URL الديناميكية).
function buildTrackingUrlSuffix(orderNumber: string, guestTrackingToken: string | null): string {
  const suffix = encodeURIComponent(orderNumber)
  return guestTrackingToken ? `${suffix}?t=${encodeURIComponent(guestTrackingToken)}` : suffix
}

export interface SendOrderConfirmationOptions {
  // موجودة فقط للإرسال اليدوي المتعمّد من الأدمن (زر "إعادة الإرسال" في لوحة التحكم) —
  // بديل عن force:boolean القديم، وبتحمل هوية الأدمن الفاعل الحقيقية بدل NULL (عشان سجل
  // whatsapp_messages يقدر يفرّق بوضوح بين إشعار تلقائي بحت وإعادة إرسال يدوية). تمريرها
  // بيخلي الإرسال يتخطى نظام ملكية الإشعار التلقائي بالكامل عمداً — فعل بشري صريح ومقصود
  // مش "محاولة تلقائية مكررة"، ومسموح يتكرر براحة الأدمن من غير ما يلمس صف الملكية الأصلي.
  manualActorUserId?: string
}

// نقطة الدمج مع إنشاء الطلب — بتتنفّذ بعد الـ commit الفعلي (راجع استدعاءها في
// orderService.createOrder)، ومصمّمة عمداً عشان أبداً ما ترمي استثناء لفوق: أي فشل (عدم
// إعداد، قالب مفقود، خطأ مزوّد، خطأ شبكة) بيتسجّل ويترجع بهدوء، الطلب نفسه فضل ناجح فعلاً
// قبل ما الدالة دي حتى تتنادى.
//
// المسار التلقائي (من غير manualActorUserId) بيعتمد حصرياً على claimAutomaticNotification
// (راجع whatsappNotificationDeliveryService.ts) لضمان إرسال Meta واحد بالظبط تحت أي تزامن
// حقيقي — مفيش أي فحص SELECT-then-send هنا، القرار كله من نتيجة الـ claim الذرّي.
export async function sendOrderConfirmationWhatsApp(order: OrderConfirmationInput, options: SendOrderConfirmationOptions = {}): Promise<void> {
  try {
    if (!whatsappConfigured) return
    if (!ORDER_CONFIRMATION_TEMPLATE_NAME) {
      logWarn('whatsapp_order_confirmation_template_missing', { orderId: order.orderId })
      return
    }

    // القالب الداخلي القابل للتعديل من لوحة التحكم (category='order_confirmation') بيُستخدم
    // هنا حصراً لبناء previewBody (نص وصفي يتخزن في whatsapp_messages.body للعرض/التدقيق في
    // لوحة التحكم) — مش المُرسل فعلياً لـ Meta؛ المُرسل الفعلي حصراً هو ORDER_CONFIRMATION_TEMPLATE_NAME
    // (قالب Meta المعتمد، راجع server/docs/WHATSAPP_ORDER_CONFIRMATION_TEMPLATE.md) عبر components تحت.
    const { rows: templateRows } = await pool.query<{ content: string }>(
      `SELECT content FROM whatsapp_templates WHERE category = $1 AND active = 1 ORDER BY created_at ASC LIMIT 1`,
      [ORDER_CONFIRMATION_CATEGORY]
    )
    const slotLabel = await resolveDeliverySlotLabel(order.deliverySlotId)
    const deliveryDateLabel = order.deliveryDate ? formatArabicDateWesternDigits(order.deliveryDate) : 'أقرب موعد متاح'
    const paymentMethodLabel = order.paymentMethod === 'COD' ? 'الدفع عند الاستلام' : order.paymentMethod
    const previewBody = templateRows[0]
      ? renderWhatsAppTemplate(templateRows[0].content, {
          customerName: order.customerName,
          orderNumber: order.orderNumber,
          orderTotal: order.total.toFixed(2),
          paymentMethod: paymentMethodLabel,
          deliveryDate: deliveryDateLabel,
          deliverySlot: slotLabel,
          customerAddress: order.customerAddress,
          trackingUrl: buildTrackingUrl(order.orderNumber, order.guestTrackingToken)
        })
      : `تأكيد طلب رقم ${order.orderNumber} لـ ${order.customerName}`

    const components: WhatsAppTemplateComponent[] = [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: order.customerName },
          { type: 'text', text: order.orderNumber },
          { type: 'text', text: order.total.toFixed(2) },
          { type: 'text', text: paymentMethodLabel },
          { type: 'text', text: `${deliveryDateLabel} - ${slotLabel}` },
          { type: 'text', text: order.customerAddress }
        ]
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: buildTrackingUrlSuffix(order.orderNumber, order.guestTrackingToken) }]
      }
    ]

    if (options.manualActorUserId) {
      await sendWhatsAppTemplateMessage({
        toNumber: order.customerMobile,
        templateName: ORDER_CONFIRMATION_TEMPLATE_NAME,
        languageCode: ORDER_CONFIRMATION_LANGUAGE,
        components,
        previewBody,
        orderId: order.orderId,
        createdByUserId: options.manualActorUserId,
        notificationType: ORDER_CONFIRMATION_CATEGORY
      })
      return
    }

    const claim = await claimAutomaticNotification(order.orderId, ORDER_CONFIRMATION_CATEGORY)
    if (!claim.claimed) return // already_sent / active_owner / max_attempts_reached — عملية تانية صاحبة الحق أو خلصت المهمة فعلاً

    const result = await sendWhatsAppTemplateMessage({
      toNumber: order.customerMobile,
      templateName: ORDER_CONFIRMATION_TEMPLATE_NAME,
      languageCode: ORDER_CONFIRMATION_LANGUAGE,
      components,
      previewBody,
      orderId: order.orderId,
      createdByUserId: null,
      notificationType: ORDER_CONFIRMATION_CATEGORY
    })

    if (!result.ok) {
      // رقم موبايل غير صالح فعلياً محفوظ بالخطأ في بيانات الطلب — إعادة المحاولة لاحقاً
      // مش هتحل المشكلة، فده failure_class='permanent' صريح عشان نظام الملكية وسكربت
      // إعادة المحاولة الدوري يتجاهلوه تماماً (راجع claimAutomaticNotification).
      await markNotificationFailed(claim.deliveryId, claim.ownerToken, 'permanent', result.reason)
      logWarn('whatsapp_order_confirmation_failed', { orderId: order.orderId, error: result.reason })
      return
    }

    if (result.sent) {
      await markNotificationSent(claim.deliveryId, claim.ownerToken, result.providerMessageId)
      logEvent('whatsapp_order_confirmation_sent', { orderId: order.orderId, orderNumber: order.orderNumber })
      return
    }

    // errorClass جاي مباشرة من callWhatsAppCloudApiTemplate (راجع تعليقه فوق) وبيتخزن كـ
    // failure_class صريح — ده المصدر الوحيد اللي بيقرر أهلية إعادة المحاولة التلقائية،
    // مفيش أي اعتماد على تحليل نص result.error لاحقاً.
    if (result.errorClass === 'unknown') {
      logWarn('whatsapp_notification_provider_result_unknown', {
        orderId: order.orderId, notificationType: ORDER_CONFIRMATION_CATEGORY, attemptCount: claim.attemptCount
      })
    }
    await markNotificationFailed(claim.deliveryId, claim.ownerToken, result.errorClass, result.error)
    logWarn('whatsapp_order_confirmation_failed', { orderId: order.orderId, error: result.error })
  } catch (err) {
    logWarn('whatsapp_order_confirmation_error', { orderId: order.orderId, error: err instanceof Error ? err.message : 'unknown_error' })
  }
}

// دفعة محدودة من إعادة محاولة الإشعارات التلقائية الفاشلة القابلة لإعادة المحاولة — تُستدعى
// حصرياً من سكربت دوري منفصل (راجع src/whatsappRetryFailedConfirmations.ts وتوثيق الجدولة في
// docs/WHATSAPP_ORDER_CONFIRMATION_RETRY_CRON.md)، أبداً مش من أي مسار HTTP مباشر. كل عنصر
// بيعيد بناء بيانات الطلب من قاعدة البيانات ثم ينادي نفس مسار claimAutomaticNotification فوق
// (نفس الذرّية بالظبط، مفيش أي فرق منطقي عن أول محاولة).
export interface RetryBatchResult {
  attempted: number
  sent: number
  failed: number
}

export async function retryFailedOrderConfirmations(batchSize = 20): Promise<RetryBatchResult> {
  const candidates = await listRetryableFailedNotifications(ORDER_CONFIRMATION_CATEGORY, batchSize)
  let sent = 0
  let failed = 0

  for (const candidate of candidates) {
    const { rows } = await pool.query<OrderConfirmationSourceRow>(
      `SELECT id, order_number as "orderNumber", customer_full_name as "customerName", customer_mobile as "customerMobile",
              customer_governorate as "customerGovernorate", customer_address as "customerAddress", payment_method as "paymentMethod",
              total, delivery_date as "deliveryDate", delivery_slot as "deliverySlotId", guest_tracking_token as "guestTrackingToken"
       FROM orders WHERE id = $1`,
      [candidate.orderId]
    )
    const order = rows[0]
    if (!order) { failed++; continue }

    const before = await getAutomaticNotificationStatus(candidate.orderId, ORDER_CONFIRMATION_CATEGORY)
    await sendOrderConfirmationWhatsApp({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerMobile: order.customerMobile,
      customerAddress: `${order.customerGovernorate} - ${order.customerAddress}`,
      paymentMethod: order.paymentMethod,
      total: order.total,
      deliveryDate: order.deliveryDate,
      deliverySlotId: order.deliverySlotId,
      guestTrackingToken: order.guestTrackingToken
    })
    const after = await getAutomaticNotificationStatus(candidate.orderId, ORDER_CONFIRMATION_CATEGORY)
    if (after?.status === 'sent' && after.updatedAt !== before?.updatedAt) sent++
    else failed++
  }

  return { attempted: candidates.length, sent, failed }
}

interface OrderConfirmationSourceRow {
  id: string; orderNumber: string; customerName: string; customerMobile: string
  customerGovernorate: string; customerAddress: string; paymentMethod: string; total: number
  deliveryDate: string | null; deliverySlotId: string; guestTrackingToken: string | null
}
