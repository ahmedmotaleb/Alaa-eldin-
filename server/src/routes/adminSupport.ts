import { Router } from 'express'
import { requireAdmin, requirePermission } from '../auth.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { notifySupportTicketUpdate } from '../services/pushService.js'
import { logEvent } from '../logger.js'
import {
  TICKET_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES,
  type TicketStatus, type TicketPriority, type TicketCategory,
  listTicketsForAdmin, getTicketDetailForAdmin, adminReply,
  assignTicket, updateTicketStatus, updateTicketPriority, listEligibleAssignees
} from '../services/supportTicketService.js'

export const adminSupportRouter = Router()
adminSupportRouter.use(requireAdmin)

const MAX_MESSAGE_LENGTH = 5000

function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 20))
  return { page, limit }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

adminSupportRouter.get('/assignable-staff', requirePermission('support.assign'), async (_req, res) => {
  const staff = await listEligibleAssignees()
  res.json({ staff })
})

adminSupportRouter.get('/tickets', requirePermission('support.view'), async (req, res) => {
  const { page, limit } = parsePagination(req.query as Record<string, unknown>)
  const q = req.query as Record<string, unknown>
  const status = str(q.status)
  const priority = str(q.priority)
  const category = str(q.category)
  const { tickets, pagination } = await listTicketsForAdmin({
    status: status && (TICKET_STATUSES as readonly string[]).includes(status) ? status as TicketStatus : undefined,
    priority: priority && (TICKET_PRIORITIES as readonly string[]).includes(priority) ? priority as TicketPriority : undefined,
    category: category && (TICKET_CATEGORIES as readonly string[]).includes(category) ? category as TicketCategory : undefined,
    assignedAdminId: str(q.assignedAdminId),
    customerId: str(q.customerId),
    search: str(q.search)
  }, page, limit)
  res.json({ tickets, pagination })
})

adminSupportRouter.get('/tickets/:id', requirePermission('support.view'), async (req, res) => {
  const detail = await getTicketDetailForAdmin(String(req.params.id))
  if (!detail) {
    res.status(404).json({ error: 'ticket_not_found' })
    return
  }
  res.json(detail)
})

adminSupportRouter.post('/tickets/:id/messages', requirePermission('support.reply'), async (req, res) => {
  const ticketId = String(req.params.id)
  const body = req.body as Record<string, unknown>
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const internalNote = body.internalNote === true
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: 'invalid_request' })
    return
  }

  const ticket = await getTicketDetailForAdmin(ticketId)
  if (!ticket) { res.status(404).json({ error: 'ticket_not_found' }); return }

  const result = await adminReply(ticketId, req.user!.id, message, internalNote)
  if ('error' in result) {
    res.status(404).json({ error: result.error })
    return
  }
  if (!internalNote) {
    notifySupportTicketUpdate(ticket.ticket.customerId, ticket.ticket.ticketNumber, 'admin_replied').catch(() => {})
  }
  logEvent('support_ticket_admin_reply', { ticketId, adminUserId: req.user!.id, internalNote })
  res.status(201).json({ message: result })
})

adminSupportRouter.patch('/tickets/:id/status', requirePermission('support.manage'), async (req, res) => {
  const ticketId = String(req.params.id)
  const status = (req.body as Record<string, unknown>).status
  const before = await getTicketDetailForAdmin(ticketId)
  if (!before) { res.status(404).json({ error: 'ticket_not_found' }); return }

  const result = await updateTicketStatus(ticketId, status as TicketStatus)
  if ('error' in result) {
    res.status(result.error === 'ticket_not_found' ? 404 : 400).json({ error: result.error })
    return
  }
  await recordAuditLog({
    adminUserId: req.user!.id, action: 'support_ticket_status_changed', entityType: 'support_ticket', entityId: ticketId,
    oldValues: { status: before.ticket.status }, newValues: { status: result.status }
  })
  if (result.status === 'resolved') {
    notifySupportTicketUpdate(result.customerId, result.ticketNumber, 'resolved').catch(() => {})
  }
  logEvent('support_ticket_status_changed', { ticketId, adminUserId: req.user!.id, status: result.status })
  res.json({ ticket: result })
})

adminSupportRouter.patch('/tickets/:id/priority', requirePermission('support.manage'), async (req, res) => {
  const ticketId = String(req.params.id)
  const priority = (req.body as Record<string, unknown>).priority
  const before = await getTicketDetailForAdmin(ticketId)
  if (!before) { res.status(404).json({ error: 'ticket_not_found' }); return }

  const result = await updateTicketPriority(ticketId, priority as TicketPriority)
  if ('error' in result) {
    res.status(result.error === 'ticket_not_found' ? 404 : 400).json({ error: result.error })
    return
  }
  await recordAuditLog({
    adminUserId: req.user!.id, action: 'support_ticket_priority_changed', entityType: 'support_ticket', entityId: ticketId,
    oldValues: { priority: before.ticket.priority }, newValues: { priority: result.priority }
  })
  logEvent('support_ticket_priority_changed', { ticketId, adminUserId: req.user!.id, priority: result.priority })
  res.json({ ticket: result })
})

adminSupportRouter.patch('/tickets/:id/assign', requirePermission('support.assign'), async (req, res) => {
  const ticketId = String(req.params.id)
  const body = req.body as Record<string, unknown>
  const assigneeId = typeof body.assigneeId === 'string' && body.assigneeId.trim() ? body.assigneeId.trim() : null
  const before = await getTicketDetailForAdmin(ticketId)
  if (!before) { res.status(404).json({ error: 'ticket_not_found' }); return }

  const result = await assignTicket(ticketId, assigneeId)
  if ('error' in result) {
    res.status(result.error === 'ticket_not_found' ? 404 : 400).json({ error: result.error })
    return
  }
  await recordAuditLog({
    adminUserId: req.user!.id, action: 'support_ticket_assigned', entityType: 'support_ticket', entityId: ticketId,
    oldValues: { assignedAdminId: before.ticket.assignedAdminId }, newValues: { assignedAdminId: result.assignedAdminId }
  })
  logEvent('support_ticket_assigned', { ticketId, adminUserId: req.user!.id, assigneeId: result.assignedAdminId })
  res.json({ ticket: result })
})
