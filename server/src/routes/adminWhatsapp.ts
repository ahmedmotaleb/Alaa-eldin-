import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin, requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import {
  listWhatsAppTemplates, createWhatsAppTemplate, updateWhatsAppTemplate,
  renderWhatsAppTemplate, sendWhatsAppMessage, listWhatsAppMessagesForOrder,
  whatsappConfigured, type WhatsAppTemplateInput
} from '../services/whatsappService.js'

export const adminWhatsappRouter = Router()
adminWhatsappRouter.use(requireAdmin)

// حالة الاتصال بالـ API الحقيقي فقط (متصل أو لأ) — التوكن نفسه أبداً ما بيترجعش هنا.
adminWhatsappRouter.get('/status', requirePermission('marketing.manage'), async (_req, res) => {
  res.json({ configured: whatsappConfigured })
})

adminWhatsappRouter.get('/templates', requirePermission('marketing.manage'), async (_req, res) => {
  const templates = await listWhatsAppTemplates()
  res.json({ templates })
})

function parseTemplateInput(body: unknown): WhatsAppTemplateInput | null {
  const b = body as Record<string, unknown>
  if (typeof b?.name !== 'string' || !b.name.trim()) return null
  if (typeof b?.content !== 'string' || !b.content.trim()) return null
  return {
    name: b.name.trim(),
    category: typeof b.category === 'string' && b.category.trim() ? b.category.trim() : 'custom',
    content: b.content.trim(),
    active: b.active !== false
  }
}

adminWhatsappRouter.post('/templates', requirePermission('marketing.manage'), async (req, res) => {
  const input = parseTemplateInput(req.body)
  if (!input) { res.status(400).json({ error: 'missing_fields' }); return }

  try {
    const template = await createWhatsAppTemplate(input)
    await recordAuditLog({
      adminUserId: req.user!.id, action: 'whatsapp_template_created', entityType: 'whatsapp_template',
      entityId: template.id, newValues: { name: template.name }
    })
    res.status(201).json({ template })
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      res.status(409).json({ error: 'name_taken' })
      return
    }
    throw err
  }
})

adminWhatsappRouter.patch('/templates/:id', requirePermission('marketing.manage'), async (req, res) => {
  const input = parseTemplateInput(req.body)
  if (!input) { res.status(400).json({ error: 'missing_fields' }); return }

  const template = await updateWhatsAppTemplate(String(req.params.id), input)
  if (!template) { res.status(404).json({ error: 'template_not_found' }); return }

  await recordAuditLog({
    adminUserId: req.user!.id, action: 'whatsapp_template_updated', entityType: 'whatsapp_template',
    entityId: template.id, newValues: { name: template.name, active: template.active }
  })
  res.json({ template })
})

interface OrderCustomerRow { id: string; orderNumber: string; customerFullName: string; customerMobile: string }

// إرسال رسالة حقيقية لعميل طلب معين — إما بمحتوى قالب (مع استبدال المتغيرات) أو نص حر.
adminWhatsappRouter.post('/orders/:orderId/send', requirePermission('marketing.manage'), async (req, res) => {
  const { rows } = await pool.query<OrderCustomerRow>(
    `SELECT id, order_number as "orderNumber", customer_full_name as "customerFullName", customer_mobile as "customerMobile"
     FROM orders WHERE id = $1`,
    [req.params.orderId]
  )
  const order = rows[0]
  if (!order) { res.status(404).json({ error: 'order_not_found' }); return }

  const b = req.body as Record<string, unknown>
  let body: string
  let templateId: string | null = null

  if (typeof b?.templateId === 'string' && b.templateId.trim()) {
    const { rows: tplRows } = await pool.query<{ id: string; content: string }>(
      'SELECT id, content FROM whatsapp_templates WHERE id = $1 AND active = 1',
      [b.templateId]
    )
    if (!tplRows[0]) { res.status(404).json({ error: 'template_not_found' }); return }
    templateId = tplRows[0].id
    body = renderWhatsAppTemplate(tplRows[0].content, { customerName: order.customerFullName, orderNumber: order.orderNumber })
  } else if (typeof b?.body === 'string' && b.body.trim()) {
    body = b.body.trim()
  } else {
    res.status(400).json({ error: 'missing_fields' })
    return
  }

  const result = await sendWhatsAppMessage({
    toNumber: order.customerMobile,
    body,
    orderId: order.id,
    templateId,
    createdByUserId: req.user!.id
  })

  if (!result.ok) {
    const status = result.reason === 'whatsapp_not_configured' ? 409 : 400
    res.status(status).json({ error: result.reason })
    return
  }

  await recordAuditLog({
    adminUserId: req.user!.id, action: 'whatsapp_message_sent', entityType: 'order',
    entityId: order.id, newValues: { sent: result.sent, templateId }
  })

  if (!result.sent) { res.status(502).json({ error: result.error, messageId: result.messageId }); return }
  res.status(201).json({ sent: true, messageId: result.messageId })
})

adminWhatsappRouter.get('/orders/:orderId/messages', requirePermission('marketing.manage'), async (req, res) => {
  const messages = await listWhatsAppMessagesForOrder(String(req.params.orderId))
  res.json({ messages })
})
