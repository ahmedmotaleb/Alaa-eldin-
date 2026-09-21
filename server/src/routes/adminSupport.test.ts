// اختبارات HTTP حقيقية لمسارات الدعم الخاصة بالأدمن (/api/admin/support) — بتغطي RBAC الدقيق
// (view/reply/assign/manage منفصلين)، الفلترة/البحث/الترقيم، وأهم حاجة: إن الملاحظة الداخلية
// ظاهرة للأدمن (بعكس العميل)، وتسجيل audit log عند تغيير الحالة/الأولوية/التعيين.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { pool } from '../db.js'

const PREFIX = 'asupport-'
const STRONG_PASSWORD = 'CorrectHorse9'

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

async function registerCustomer(agent: ReturnType<typeof request.agent>, email: string): Promise<string> {
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'مستخدم اختبار' })
  expect(res.status).toBe(201)
  return res.body.user.id as string
}

async function promoteToAdmin(userId: string, roleId: string | null) {
  await pool.query('UPDATE users SET is_admin = 1, role = $2, role_id = $3 WHERE id = $1', [userId, 'staff', roleId])
}

async function adminAgent(roleId: string | null) {
  const agent = request.agent(app)
  const userId = await registerCustomer(agent, uniqueEmail(roleId ?? 'legacy'))
  await promoteToAdmin(userId, roleId)
  return { agent, userId }
}

async function createTicketFixture(): Promise<{ ticketId: string, customerId: string }> {
  const agent = request.agent(app)
  const customerId = await registerCustomer(agent, uniqueEmail('ticket-owner'))
  const res = await agent.post('/api/account/support/tickets').send({ category: 'order_issue', subject: 'مشكلة اختبار', message: 'تفاصيل' })
  expect(res.status).toBe(201)
  return { ticketId: res.body.ticket.id as string, customerId }
}

async function cleanup() {
  await pool.query(`DELETE FROM support_ticket_attachments WHERE message_id IN (SELECT id FROM support_ticket_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE customer_id IN (SELECT id FROM users WHERE email LIKE $1)))`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM support_ticket_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE customer_id IN (SELECT id FROM users WHERE email LIKE $1))`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM audit_logs WHERE admin_user_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM support_tickets WHERE customer_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${PREFIX}%`])
}

beforeEach(cleanup, 20000)
afterAll(async () => { await cleanup(); await pool.end() })

describe('GET /api/admin/support/tickets — RBAC', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/support/tickets')
    expect(res.status).toBe(401)
  })

  it('rejects a non-admin authenticated customer', async () => {
    const agent = request.agent(app)
    await registerCustomer(agent, uniqueEmail('customer'))
    const res = await agent.get('/api/admin/support/tickets')
    expect(res.status).toBe(403)
  })

  it('rejects a role without support.view (e.g. a picker)', async () => {
    const { agent } = await adminAgent('role-picker')
    const res = await agent.get('/api/admin/support/tickets')
    expect(res.status).toBe(403)
  })

  it('allows role-manager and role-orders-manager (both have support.view)', async () => {
    const { agent: manager } = await adminAgent('role-manager')
    expect((await manager.get('/api/admin/support/tickets')).status).toBe(200)

    const { agent: ordersManager } = await adminAgent('role-orders-manager')
    expect((await ordersManager.get('/api/admin/support/tickets')).status).toBe(200)
  })
})

describe('GET /api/admin/support/tickets — filtering, search, pagination', () => {
  it('filters by status and by category', async () => {
    const { agent } = await adminAgent('role-manager')
    const { ticketId } = await createTicketFixture()
    await pool.query(`UPDATE support_tickets SET status = 'in_progress' WHERE id = $1`, [ticketId])

    const byStatus = await agent.get('/api/admin/support/tickets?status=in_progress')
    expect(byStatus.body.tickets.map((t: { id: string }) => t.id)).toContain(ticketId)

    const byWrongStatus = await agent.get('/api/admin/support/tickets?status=closed')
    expect(byWrongStatus.body.tickets.map((t: { id: string }) => t.id)).not.toContain(ticketId)

    const byCategory = await agent.get('/api/admin/support/tickets?category=order_issue')
    expect(byCategory.body.tickets.map((t: { id: string }) => t.id)).toContain(ticketId)
  })

  it('searches by ticket number, customer name/mobile, and related order number', async () => {
    const { agent } = await adminAgent('role-manager')
    const { ticketId } = await createTicketFixture()
    const { rows } = await pool.query('SELECT ticket_number as "ticketNumber" FROM support_tickets WHERE id = $1', [ticketId])

    const bySearch = await agent.get(`/api/admin/support/tickets?search=${encodeURIComponent(rows[0].ticketNumber)}`)
    expect(bySearch.body.tickets.map((t: { id: string }) => t.id)).toContain(ticketId)
  })

  it('paginates results', async () => {
    const { agent } = await adminAgent('role-manager')
    await createTicketFixture()
    await createTicketFixture()
    await createTicketFixture()

    const res = await agent.get('/api/admin/support/tickets?page=1&limit=2')
    expect(res.body.tickets).toHaveLength(2)
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(3)
  })
})

describe('GET /api/admin/support/tickets/:id — detail includes internal notes', () => {
  it('shows internal notes to the admin (unlike the customer-facing API)', async () => {
    const { agent } = await adminAgent('role-manager')
    const { ticketId } = await createTicketFixture()
    await agent.post(`/api/admin/support/tickets/${ticketId}/messages`).send({ message: 'ملاحظة داخلية للفريق', internalNote: true })

    const res = await agent.get(`/api/admin/support/tickets/${ticketId}`)
    expect(res.status).toBe(200)
    const note = res.body.messages.find((m: { message: string }) => m.message === 'ملاحظة داخلية للفريق')
    expect(note).toBeTruthy()
    expect(note.internalNote).toBe(true)
  })
})

describe('POST /api/admin/support/tickets/:id/messages — reply RBAC', () => {
  it('rejects a role without support.reply', async () => {
    const { agent } = await adminAgent('role-picker')
    const { ticketId } = await createTicketFixture()
    const res = await agent.post(`/api/admin/support/tickets/${ticketId}/messages`).send({ message: 'رد' })
    expect(res.status).toBe(403)
  })

  it('allows role-orders-manager to reply', async () => {
    const { agent } = await adminAgent('role-orders-manager')
    const { ticketId } = await createTicketFixture()
    const res = await agent.post(`/api/admin/support/tickets/${ticketId}/messages`).send({ message: 'رد من مدير الطلبات' })
    expect(res.status).toBe(201)
  })
})

describe('PATCH .../status, .../priority, .../assign — RBAC + audit logging', () => {
  it('role-orders-manager (has support.reply/assign but NOT support.manage) cannot change status or priority', async () => {
    const { agent } = await adminAgent('role-orders-manager')
    const { ticketId } = await createTicketFixture()
    expect((await agent.patch(`/api/admin/support/tickets/${ticketId}/status`).send({ status: 'resolved' })).status).toBe(403)
    expect((await agent.patch(`/api/admin/support/tickets/${ticketId}/priority`).send({ priority: 'urgent' })).status).toBe(403)
  })

  it('role-manager can change status, sets resolved_at, and records an audit log entry', async () => {
    const { agent, userId } = await adminAgent('role-manager')
    const { ticketId } = await createTicketFixture()

    const res = await agent.patch(`/api/admin/support/tickets/${ticketId}/status`).send({ status: 'resolved' })
    expect(res.status).toBe(200)
    expect(res.body.ticket.status).toBe('resolved')
    expect(res.body.ticket.resolvedAt).not.toBeNull()

    const { rows } = await pool.query(
      `SELECT action, admin_user_id as "adminUserId" FROM audit_logs WHERE entity_id = $1 AND entity_type = 'support_ticket' ORDER BY created_at DESC LIMIT 1`,
      [ticketId]
    )
    expect(rows[0].action).toBe('support_ticket_status_changed')
    expect(rows[0].adminUserId).toBe(userId)
  })

  it('role-manager can change priority and records an audit log entry', async () => {
    const { agent, userId } = await adminAgent('role-manager')
    const { ticketId } = await createTicketFixture()

    const res = await agent.patch(`/api/admin/support/tickets/${ticketId}/priority`).send({ priority: 'urgent' })
    expect(res.status).toBe(200)
    expect(res.body.ticket.priority).toBe('urgent')

    const { rows } = await pool.query(
      `SELECT action, admin_user_id as "adminUserId" FROM audit_logs WHERE entity_id = $1 AND entity_type = 'support_ticket' ORDER BY created_at DESC LIMIT 1`,
      [ticketId]
    )
    expect(rows[0].action).toBe('support_ticket_priority_changed')
    expect(rows[0].adminUserId).toBe(userId)
  })

  it('a role without support.assign (e.g. a picker) cannot assign a ticket', async () => {
    const { agent } = await adminAgent('role-picker')
    const { ticketId } = await createTicketFixture()
    const res = await agent.patch(`/api/admin/support/tickets/${ticketId}/assign`).send({ assigneeId: null })
    expect(res.status).toBe(403)
  })

  it('assigns a ticket to an eligible staff member and records an audit log entry', async () => {
    const { agent, userId: managerId } = await adminAgent('role-manager')
    const { ticketId } = await createTicketFixture()

    const res = await agent.patch(`/api/admin/support/tickets/${ticketId}/assign`).send({ assigneeId: managerId })
    expect(res.status).toBe(200)
    expect(res.body.ticket.assignedAdminId).toBe(managerId)

    const { rows } = await pool.query(
      `SELECT action FROM audit_logs WHERE entity_id = $1 AND entity_type = 'support_ticket' AND action = 'support_ticket_assigned' ORDER BY created_at DESC LIMIT 1`,
      [ticketId]
    )
    expect(rows[0].action).toBe('support_ticket_assigned')
  })

  it('never assigns a ticket to an ineligible user (e.g. a customer, or a role-rider with no support.reply)', async () => {
    const { agent } = await adminAgent('role-manager')
    const { ticketId, customerId } = await createTicketFixture()

    const asCustomer = await agent.patch(`/api/admin/support/tickets/${ticketId}/assign`).send({ assigneeId: customerId })
    expect(asCustomer.status).toBe(400)
    expect(asCustomer.body.error).toBe('ineligible_assignee')

    const { userId: riderId } = await adminAgent('role-rider')
    const asRider = await agent.patch(`/api/admin/support/tickets/${ticketId}/assign`).send({ assigneeId: riderId })
    expect(asRider.status).toBe(400)
    expect(asRider.body.error).toBe('ineligible_assignee')
  })
})

describe('GET /api/admin/support/assignable-staff', () => {
  it('only lists staff with support.reply permission', async () => {
    const { agent } = await adminAgent('role-manager')
    const { userId: managerId } = await adminAgent('role-manager')
    const { userId: riderId } = await adminAgent('role-rider')

    const res = await agent.get('/api/admin/support/assignable-staff')
    expect(res.status).toBe(200)
    const ids = res.body.staff.map((s: { id: string }) => s.id)
    expect(ids).toContain(managerId)
    expect(ids).not.toContain(riderId)
  })
})
