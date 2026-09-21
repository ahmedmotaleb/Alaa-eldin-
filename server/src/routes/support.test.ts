// اختبارات HTTP حقيقية لمسارات الدعم الخاصة بالعميل (/api/account/support) — بتغطي أهم قيود
// الأمان: ملكية الطلب المربوط (Customer A ما يقدرش يربط طلب Customer B)، عزل التذاكر بين
// العملاء (Customer B ما يقدرش يقرأ تذكرة Customer A)، وإن الملاحظات الداخلية (internal_note)
// أبداً ما بترجعش عبر أي استجابة لواجهة العميل.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'
import { addMessage } from '../services/supportTicketService.js'

const PREFIX = 'csupport-'
const STRONG_PASSWORD = 'CorrectHorse9'

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

async function registerCustomer(email: string) {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'عميل اختبار الدعم' })
  expect(res.status).toBe(201)
  return { agent, userId: res.body.user.id as string }
}

async function cleanup() {
  await pool.query(`DELETE FROM support_ticket_attachments WHERE message_id IN (SELECT id FROM support_ticket_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE customer_id IN (SELECT id FROM users WHERE email LIKE $1)))`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM support_ticket_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE customer_id IN (SELECT id FROM users WHERE email LIKE $1))`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM support_tickets WHERE customer_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM orders WHERE id LIKE $1`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${PREFIX}%`])
}

beforeEach(cleanup, 20000)
afterAll(async () => { await cleanup(); await pool.end() })

describe('POST /api/account/support/tickets', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/account/support/tickets').send({ category: 'other', subject: 's', message: 'm' })
    expect(res.status).toBe(401)
  })

  it('creates a ticket with a human-readable SUP-###### ticket number', async () => {
    const { agent } = await registerCustomer(uniqueEmail('a'))
    const res = await agent.post('/api/account/support/tickets').send({ category: 'order_issue', subject: 'مشكلة', message: 'تفاصيل المشكلة' })
    expect(res.status).toBe(201)
    expect(res.body.ticket.ticketNumber).toMatch(/^SUP-\d+$/)
    expect(res.body.ticket.status).toBe('open')
    expect(res.body.ticket.priority).toBe('normal')
  })

  it('rejects an invalid category', async () => {
    const { agent } = await registerCustomer(uniqueEmail('a'))
    const res = await agent.post('/api/account/support/tickets').send({ category: 'not_a_real_category', subject: 's', message: 'm' })
    expect(res.status).toBe(400)
  })

  it('ignores a customer-submitted priority — priority is always server-defaulted to normal', async () => {
    const { agent } = await registerCustomer(uniqueEmail('a'))
    const res = await agent.post('/api/account/support/tickets')
      .send({ category: 'other', subject: 's', message: 'm', priority: 'urgent' })
    expect(res.status).toBe(201)
    expect(res.body.ticket.priority).toBe('normal')
  })

  it('links an order the customer actually owns', async () => {
    const { agent, userId } = await registerCustomer(uniqueEmail('a'))
    await pool.query(
      `INSERT INTO orders (id, order_number, user_id, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_address, subtotal, delivery_fee, total, status)
       VALUES ($1, $1, $2, now(), 'now', 'cod', 'عميل', '01000000000', 'عنوان', 100, 10, 110, 'delivered')`,
      [`${PREFIX}order-a`, userId]
    )
    const res = await agent.post('/api/account/support/tickets').send({ category: 'order_issue', subject: 's', message: 'm', orderNumber: `${PREFIX}order-a` })
    expect(res.status).toBe(201)
    expect(res.body.ticket.relatedOrderNumber).toBe(`${PREFIX}order-a`)
  })

  it('never trusts a submitted order number belonging to a DIFFERENT customer', async () => {
    const { userId: ownerId } = await registerCustomer(uniqueEmail('owner'))
    await pool.query(
      `INSERT INTO orders (id, order_number, user_id, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_address, subtotal, delivery_fee, total, status)
       VALUES ($1, $1, $2, now(), 'now', 'cod', 'عميل', '01000000000', 'عنوان', 100, 10, 110, 'delivered')`,
      [`${PREFIX}order-owner`, ownerId]
    )
    const { agent: attackerAgent } = await registerCustomer(uniqueEmail('attacker'))
    const res = await attackerAgent.post('/api/account/support/tickets')
      .send({ category: 'order_issue', subject: 's', message: 'm', orderNumber: `${PREFIX}order-owner` })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('order_not_found_or_not_yours')
  })
})

describe('GET /api/account/support/tickets — isolation between customers', () => {
  it('only ever lists the requesting customer\'s own tickets', async () => {
    const { agent: agentA } = await registerCustomer(uniqueEmail('a'))
    await agentA.post('/api/account/support/tickets').send({ category: 'other', subject: 'من أ', message: 'م' })

    const { agent: agentB } = await registerCustomer(uniqueEmail('b'))
    const res = await agentB.get('/api/account/support/tickets')
    expect(res.status).toBe(200)
    expect(res.body.tickets).toHaveLength(0)
  })

  it('paginates results', async () => {
    const { agent } = await registerCustomer(uniqueEmail('a'))
    for (let i = 0; i < 3; i++) {
      await agent.post('/api/account/support/tickets').send({ category: 'other', subject: `تذكرة ${i}`, message: 'م' })
    }
    const res = await agent.get('/api/account/support/tickets?page=1&limit=2')
    expect(res.body.tickets).toHaveLength(2)
    expect(res.body.pagination.total).toBe(3)
    expect(res.body.pagination.pages).toBe(2)
  })
})

describe('GET /api/account/support/tickets/:id — ownership + internal-note security', () => {
  it('customer B cannot read customer A\'s ticket (404, not leaked)', async () => {
    const { agent: agentA } = await registerCustomer(uniqueEmail('a'))
    const created = await agentA.post('/api/account/support/tickets').send({ category: 'other', subject: 's', message: 'm' })
    const ticketId = created.body.ticket.id

    const { agent: agentB } = await registerCustomer(uniqueEmail('b'))
    const res = await agentB.get(`/api/account/support/tickets/${ticketId}`)
    expect(res.status).toBe(404)
  })

  it('NEVER returns an internal note through the customer API, even mixed with normal messages', async () => {
    const { agent, userId } = await registerCustomer(uniqueEmail('a'))
    const created = await agent.post('/api/account/support/tickets').send({ category: 'other', subject: 's', message: 'الرسالة الأولى من العميل' })
    const ticketId = created.body.ticket.id

    // ملاحظة داخلية مباشرة عن طريق service function (بمحاكاة رد أدمن بـ internalNote:true) —
    // لازم تتخزن في الداتابيز لكن أبداً ما تظهرش هنا.
    await addMessage({ ticketId, senderType: 'admin', senderUserId: userId, message: 'ملاحظة داخلية سرية', internalNote: true })
    await addMessage({ ticketId, senderType: 'admin', senderUserId: userId, message: 'رد عادي ظاهر للعميل', internalNote: false })

    const res = await agent.get(`/api/account/support/tickets/${ticketId}`)
    expect(res.status).toBe(200)
    const messageTexts = res.body.messages.map((m: { message: string }) => m.message)
    expect(messageTexts).toContain('الرسالة الأولى من العميل')
    expect(messageTexts).toContain('رد عادي ظاهر للعميل')
    expect(messageTexts).not.toContain('ملاحظة داخلية سرية')
    expect(res.body.messages.every((m: { internalNote: boolean }) => m.internalNote === false)).toBe(true)
  })
})

describe('POST /api/account/support/tickets/:id/messages — customer reply', () => {
  it('appends a customer reply visible in the conversation', async () => {
    const { agent } = await registerCustomer(uniqueEmail('a'))
    const created = await agent.post('/api/account/support/tickets').send({ category: 'other', subject: 's', message: 'm' })
    const ticketId = created.body.ticket.id

    const res = await agent.post(`/api/account/support/tickets/${ticketId}/messages`).send({ message: 'رد إضافي من العميل' })
    expect(res.status).toBe(201)

    const fetched = await agent.get(`/api/account/support/tickets/${ticketId}`)
    expect(fetched.body.messages.map((m: { message: string }) => m.message)).toContain('رد إضافي من العميل')
  })

  it('rejects a reply on a closed ticket', async () => {
    const { agent } = await registerCustomer(uniqueEmail('a'))
    const created = await agent.post('/api/account/support/tickets').send({ category: 'other', subject: 's', message: 'm' })
    const ticketId = created.body.ticket.id
    await pool.query(`UPDATE support_tickets SET status = 'closed' WHERE id = $1`, [ticketId])

    const res = await agent.post(`/api/account/support/tickets/${ticketId}/messages`).send({ message: 'محاولة رد' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('ticket_closed')
  })

  it('reopens a resolved ticket back to in_progress when the customer replies', async () => {
    const { agent } = await registerCustomer(uniqueEmail('a'))
    const created = await agent.post('/api/account/support/tickets').send({ category: 'other', subject: 's', message: 'm' })
    const ticketId = created.body.ticket.id
    await pool.query(`UPDATE support_tickets SET status = 'resolved', resolved_at = now() WHERE id = $1`, [ticketId])

    const res = await agent.post(`/api/account/support/tickets/${ticketId}/messages`).send({ message: 'المشكلة رجعت تاني' })
    expect(res.status).toBe(201)

    const fetched = await agent.get(`/api/account/support/tickets/${ticketId}`)
    expect(fetched.body.ticket.status).toBe('in_progress')
    expect(fetched.body.ticket.resolvedAt).toBeNull()
  })

  it('cannot reply to another customer\'s ticket', async () => {
    const { agent: agentA } = await registerCustomer(uniqueEmail('a'))
    const created = await agentA.post('/api/account/support/tickets').send({ category: 'other', subject: 's', message: 'm' })
    const ticketId = created.body.ticket.id

    const { agent: agentB } = await registerCustomer(uniqueEmail('b'))
    const res = await agentB.post(`/api/account/support/tickets/${ticketId}/messages`).send({ message: 'محاولة تسلل' })
    expect(res.status).toBe(404)
  })
})
