import crypto from 'node:crypto'
import { pool } from '../db.js'
import { getUserPermissions } from './permissionService.js'

export const TICKET_CATEGORIES = [
  'order_issue', 'missing_item', 'damaged_item', 'wrong_item',
  'delivery_issue', 'refund_request', 'payment_issue', 'account_issue',
  'suggestion', 'other'
] as const
export type TicketCategory = typeof TICKET_CATEGORIES[number]

export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const
export type TicketStatus = typeof TICKET_STATUSES[number]

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TicketPriority = typeof TICKET_PRIORITIES[number]

export interface SupportTicket {
  id: string
  ticketNumber: string
  customerId: string
  category: TicketCategory
  subject: string
  relatedOrderId: string | null
  relatedOrderNumber: string | null
  status: TicketStatus
  priority: TicketPriority
  assignedAdminId: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface SupportTicketAttachment {
  id: string
  messageId: number
  fileUrl: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

export interface SupportTicketMessage {
  id: number
  ticketId: string
  senderType: 'customer' | 'admin'
  senderUserId: string
  message: string
  internalNote: boolean
  createdAt: string
  attachments: SupportTicketAttachment[]
}

const TICKET_FIELDS = `
  t.id, t.ticket_number as "ticketNumber", t.customer_id as "customerId", t.category, t.subject,
  t.related_order_id as "relatedOrderId", o.order_number as "relatedOrderNumber",
  t.status, t.priority, t.assigned_admin_id as "assignedAdminId",
  t.created_at as "createdAt", t.updated_at as "updatedAt", t.resolved_at as "resolvedAt"
`
const TICKET_FROM = `FROM support_tickets t LEFT JOIN orders o ON o.id = t.related_order_id`

async function nextTicketNumber(): Promise<string> {
  const { rows } = await pool.query<{ n: number }>("SELECT nextval('support_ticket_number_seq') as n")
  return `SUP-${rows[0].n}`
}

// أمان أساسي: لازم يتأكد إن الطلب المطلوب ربطه بيخص العميل ده فعلاً — أبداً ما بنثق برقم
// الطلب المبعوت من الواجهة لوحده، نفس الأسلوب المُتّبع في orderService.getOrderByNumberForUser.
export async function findOwnedOrderId(orderNumber: string, customerId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM orders WHERE order_number = $1 AND user_id = $2',
    [orderNumber, customerId]
  )
  return rows[0]?.id ?? null
}

export interface CreateTicketParams {
  customerId: string
  category: TicketCategory
  subject: string
  message: string
  relatedOrderId: string | null
}

export async function createTicket(params: CreateTicketParams): Promise<SupportTicket> {
  const id = crypto.randomUUID()
  const ticketNumber = await nextTicketNumber()
  await pool.query(
    `INSERT INTO support_tickets (id, ticket_number, customer_id, category, subject, related_order_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, ticketNumber, params.customerId, params.category, params.subject, params.relatedOrderId]
  )
  await addMessage({ ticketId: id, senderType: 'customer', senderUserId: params.customerId, message: params.message, internalNote: false })
  const ticket = await getTicketById(id)
  return ticket!
}

export async function getTicketById(id: string): Promise<SupportTicket | null> {
  const { rows } = await pool.query<SupportTicket>(`SELECT ${TICKET_FIELDS} ${TICKET_FROM} WHERE t.id = $1`, [id])
  return rows[0] ?? null
}

// نفس نمط orderService.getOrderByNumberForUser بالظبط: التحقق من الملكية جزء من جملة الـ
// WHERE نفسها، مش شرط بعد الجلب.
export async function getTicketForCustomer(id: string, customerId: string): Promise<SupportTicket | null> {
  const { rows } = await pool.query<SupportTicket>(
    `SELECT ${TICKET_FIELDS} ${TICKET_FROM} WHERE t.id = $1 AND t.customer_id = $2`,
    [id, customerId]
  )
  return rows[0] ?? null
}

export interface PaginatedTickets {
  tickets: SupportTicket[]
  pagination: { page: number, limit: number, total: number, pages: number }
}

export async function listTicketsForCustomer(customerId: string, page: number, limit: number): Promise<PaginatedTickets> {
  const offset = (page - 1) * limit
  const { rows: countRows } = await pool.query<{ n: string }>(
    'SELECT COUNT(*) as n FROM support_tickets WHERE customer_id = $1', [customerId]
  )
  const total = Number(countRows[0].n)
  const { rows } = await pool.query<SupportTicket>(
    `SELECT ${TICKET_FIELDS} ${TICKET_FROM} WHERE t.customer_id = $1 ORDER BY t.updated_at DESC LIMIT $2 OFFSET $3`,
    [customerId, limit, offset]
  )
  return { tickets: rows, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } }
}

interface AddMessageParams {
  ticketId: string
  senderType: 'customer' | 'admin'
  senderUserId: string
  message: string
  internalNote: boolean
}

export async function addMessage(params: AddMessageParams): Promise<SupportTicketMessage> {
  const { rows } = await pool.query<{ id: number, createdAt: string }>(
    `INSERT INTO support_ticket_messages (ticket_id, sender_type, sender_user_id, message, internal_note)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at as "createdAt"`,
    [params.ticketId, params.senderType, params.senderUserId, params.message, params.internalNote ? 1 : 0]
  )
  await pool.query('UPDATE support_tickets SET updated_at = now() WHERE id = $1', [params.ticketId])
  return {
    id: rows[0].id, ticketId: params.ticketId, senderType: params.senderType, senderUserId: params.senderUserId,
    message: params.message, internalNote: params.internalNote, createdAt: rows[0].createdAt, attachments: []
  }
}

export async function attachFileToMessage(
  messageId: number, file: { fileUrl: string, storageKey: string, mimeType: string, sizeBytes: number }
): Promise<SupportTicketAttachment> {
  const id = crypto.randomUUID()
  const { rows } = await pool.query<{ createdAt: string }>(
    `INSERT INTO support_ticket_attachments (id, message_id, file_url, storage_key, mime_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at as "createdAt"`,
    [id, messageId, file.fileUrl, file.storageKey, file.mimeType, file.sizeBytes]
  )
  return { id, messageId, fileUrl: file.fileUrl, mimeType: file.mimeType, sizeBytes: file.sizeBytes, createdAt: rows[0].createdAt }
}

// الرسائل المتاحة للعميل بيتفلتر منها internal_note دايماً هنا — مش بس على مستوى الواجهة —
// ده أهم قيد أمان في الميزة دي كلها ولازم يتفحص صراحة في الاختبارات.
export async function listMessagesForCustomer(ticketId: string): Promise<SupportTicketMessage[]> {
  return listMessages(ticketId, { includeInternalNotes: false })
}

export async function listMessagesForAdmin(ticketId: string): Promise<SupportTicketMessage[]> {
  return listMessages(ticketId, { includeInternalNotes: true })
}

async function listMessages(ticketId: string, opts: { includeInternalNotes: boolean }): Promise<SupportTicketMessage[]> {
  const filter = opts.includeInternalNotes ? '' : 'AND internal_note = 0'
  const { rows } = await pool.query<Omit<SupportTicketMessage, 'attachments'>>(
    `SELECT id, ticket_id as "ticketId", sender_type as "senderType", sender_user_id as "senderUserId",
            message, internal_note as "internalNote", created_at as "createdAt"
     FROM support_ticket_messages WHERE ticket_id = $1 ${filter} ORDER BY created_at ASC, id ASC`,
    [ticketId]
  )
  if (rows.length === 0) return []
  const messageIds = rows.map(r => r.id)
  const { rows: attachmentRows } = await pool.query<SupportTicketAttachment>(
    `SELECT id, message_id as "messageId", file_url as "fileUrl", mime_type as "mimeType",
            size_bytes as "sizeBytes", created_at as "createdAt"
     FROM support_ticket_attachments WHERE message_id = ANY($1::int[])`,
    [messageIds]
  )
  const attachmentsByMessage = new Map<number, SupportTicketAttachment[]>()
  for (const a of attachmentRows) {
    if (!attachmentsByMessage.has(a.messageId)) attachmentsByMessage.set(a.messageId, [])
    attachmentsByMessage.get(a.messageId)!.push(a)
  }
  return rows.map(r => ({ ...r, internalNote: !!r.internalNote, attachments: attachmentsByMessage.get(r.id) ?? [] }))
}

// التذكرة المغلقة نهائياً — العميل مش قادر يضيف رسايل جديدة عليها (لازم تذكرة جديدة، أو
// الأدمن يعيد فتحها صراحة). التذكرة "محلولة" أو "بانتظار العميل" ورد العميل عليها بيرجّعها
// تلقائياً لـ "قيد المتابعة" — ده سلوك متوقّع لأي نظام تذاكر دعم عادي، مش SLA engine معقّد.
export async function customerReply(
  ticketId: string, customerId: string, message: string
): Promise<{ error: string } | SupportTicketMessage> {
  const ticket = await getTicketForCustomer(ticketId, customerId)
  if (!ticket) return { error: 'ticket_not_found' }
  if (ticket.status === 'closed') return { error: 'ticket_closed' }

  const added = await addMessage({ ticketId, senderType: 'customer', senderUserId: customerId, message, internalNote: false })
  if (ticket.status === 'waiting_customer' || ticket.status === 'resolved') {
    await pool.query(
      `UPDATE support_tickets SET status = 'in_progress', resolved_at = NULL WHERE id = $1`,
      [ticketId]
    )
  }
  return added
}

// ============ لوحة التحكم (أدمن) ============

export interface AdminTicketListFilters {
  status?: TicketStatus
  priority?: TicketPriority
  category?: TicketCategory
  assignedAdminId?: string
  customerId?: string
  search?: string
}

function isValidTicketStatus(v: unknown): v is TicketStatus {
  return typeof v === 'string' && (TICKET_STATUSES as readonly string[]).includes(v)
}

export async function listTicketsForAdmin(
  filters: AdminTicketListFilters, page: number, limit: number
): Promise<PaginatedTickets> {
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters.status) { params.push(filters.status); conditions.push(`t.status = $${params.length}`) }
  if (filters.priority) { params.push(filters.priority); conditions.push(`t.priority = $${params.length}`) }
  if (filters.category) { params.push(filters.category); conditions.push(`t.category = $${params.length}`) }
  if (filters.assignedAdminId) { params.push(filters.assignedAdminId); conditions.push(`t.assigned_admin_id = $${params.length}`) }
  if (filters.customerId) { params.push(filters.customerId); conditions.push(`t.customer_id = $${params.length}`) }
  if (filters.search?.trim()) {
    params.push(`%${filters.search.trim()}%`)
    const i = params.length
    conditions.push(`(t.ticket_number ILIKE $${i} OR u.full_name ILIKE $${i} OR u.mobile ILIKE $${i} OR o.order_number ILIKE $${i})`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const joins = `${TICKET_FROM} JOIN users u ON u.id = t.customer_id`

  const { rows: countRows } = await pool.query<{ n: string }>(`SELECT COUNT(*) as n ${joins} ${where}`, params)
  const total = Number(countRows[0].n)

  const offset = (page - 1) * limit
  const limitParamIndex = params.length + 1
  const offsetParamIndex = params.length + 2
  const { rows } = await pool.query<SupportTicket>(
    `SELECT ${TICKET_FIELDS} ${joins} ${where} ORDER BY t.created_at DESC LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    [...params, limit, offset]
  )
  return { tickets: rows, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } }
}

export interface AdminTicketDetail {
  ticket: SupportTicket
  customer: { id: string, fullName: string, email: string, mobile: string | null }
  messages: SupportTicketMessage[]
}

export async function getTicketDetailForAdmin(id: string): Promise<AdminTicketDetail | null> {
  const ticket = await getTicketById(id)
  if (!ticket) return null
  const { rows } = await pool.query<{ id: string, fullName: string, email: string, mobile: string | null }>(
    'SELECT id, full_name as "fullName", email, mobile FROM users WHERE id = $1', [ticket.customerId]
  )
  const messages = await listMessagesForAdmin(id)
  return { ticket, customer: rows[0], messages }
}

export async function adminReply(
  ticketId: string, adminUserId: string, message: string, internalNote: boolean
): Promise<{ error: string } | SupportTicketMessage> {
  const ticket = await getTicketById(ticketId)
  if (!ticket) return { error: 'ticket_not_found' }

  const added = await addMessage({ ticketId, senderType: 'admin', senderUserId: adminUserId, message, internalNote })
  // رد الأدمن على تذكرة "بتنتظر ردنا" بيرجّعها لـ "قيد المتابعة" تلقائياً — نفس منطق رد
  // العميل بالظبط بس بالعكس، وملاحظة داخلية (internal_note) ما بتغيّرش حالة التذكرة خالص
  // لأنها مش رد فعلي للعميل.
  if (!internalNote && ticket.status === 'open') {
    await pool.query(`UPDATE support_tickets SET status = 'in_progress' WHERE id = $1`, [ticketId])
  }
  return added
}

export interface EligibleAssignee {
  id: string
  fullName: string
  email: string
}

// نفس شرط isEligibleAssignee بالظبط بس بيرجع القايمة كاملة (لقائمة اختيار المُعيَّن في
// الواجهة) بدل ما يتحقق من مستخدم واحد بس.
export async function listEligibleAssignees(): Promise<EligibleAssignee[]> {
  const { rows } = await pool.query<{ id: string, fullName: string, email: string, role: 'staff' | 'admin', roleId: string | null }>(
    'SELECT id, full_name as "fullName", email, role, role_id as "roleId" FROM users WHERE is_admin = 1 ORDER BY full_name'
  )
  const eligible: EligibleAssignee[] = []
  for (const row of rows) {
    const permissions = await getUserPermissions({ isAdmin: true, role: row.role, roleId: row.roleId })
    if (permissions.has('support.reply')) eligible.push({ id: row.id, fullName: row.fullName, email: row.email })
  }
  return eligible
}

async function isEligibleAssignee(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ isAdmin: number, role: 'staff' | 'admin', roleId: string | null }>(
    'SELECT is_admin as "isAdmin", role, role_id as "roleId" FROM users WHERE id = $1', [userId]
  )
  const user = rows[0]
  if (!user || !user.isAdmin) return false
  const permissions = await getUserPermissions({ isAdmin: !!user.isAdmin, role: user.role, roleId: user.roleId })
  return permissions.has('support.reply')
}

export async function assignTicket(
  ticketId: string, assigneeId: string | null
): Promise<{ error: string } | SupportTicket> {
  const ticket = await getTicketById(ticketId)
  if (!ticket) return { error: 'ticket_not_found' }
  if (assigneeId && !(await isEligibleAssignee(assigneeId))) return { error: 'ineligible_assignee' }

  await pool.query('UPDATE support_tickets SET assigned_admin_id = $2, updated_at = now() WHERE id = $1', [ticketId, assigneeId])
  return (await getTicketById(ticketId))!
}

export async function updateTicketStatus(
  ticketId: string, status: TicketStatus
): Promise<{ error: string } | SupportTicket> {
  if (!isValidTicketStatus(status)) return { error: 'invalid_status' }
  const ticket = await getTicketById(ticketId)
  if (!ticket) return { error: 'ticket_not_found' }

  const resolvedAt = status === 'resolved' ? 'now()' : 'NULL'
  await pool.query(
    `UPDATE support_tickets SET status = $2, resolved_at = ${resolvedAt}, updated_at = now() WHERE id = $1`,
    [ticketId, status]
  )
  return (await getTicketById(ticketId))!
}

export async function updateTicketPriority(
  ticketId: string, priority: TicketPriority
): Promise<{ error: string } | SupportTicket> {
  if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) return { error: 'invalid_priority' }
  const ticket = await getTicketById(ticketId)
  if (!ticket) return { error: 'ticket_not_found' }

  await pool.query('UPDATE support_tickets SET priority = $2, updated_at = now() WHERE id = $1', [ticketId, priority])
  return (await getTicketById(ticketId))!
}
