import { Router } from 'express'
import multer from 'multer'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../auth.js'
import { ALLOWED_IMAGE_MIME, MAX_IMAGE_SIZE_BYTES, isRealImage } from '../imageValidation.js'
import { uploadImage, imageStorageConfigured, SUPPORT_ATTACHMENTS_FOLDER } from '../services/imageStorageService.js'
import {
  TICKET_CATEGORIES, type TicketCategory,
  createTicket, findOwnedOrderId, getTicketForCustomer, listTicketsForCustomer,
  listMessagesForCustomer, customerReply, attachFileToMessage
} from '../services/supportTicketService.js'
import { notifyAssignedAdminOfReply } from '../services/pushService.js'
import { logEvent } from '../logger.js'

export const supportRouter = Router()
supportRouter.use(requireAuth)

const MAX_SUBJECT_LENGTH = 200
const MAX_MESSAGE_LENGTH = 5000
const MAX_ATTACHMENTS = 3

const createTicketRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false })
const replyRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false })

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: MAX_ATTACHMENTS },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_IMAGE_MIME.has(file.mimetype))
})

function isValidCategory(value: unknown): value is TicketCategory {
  return typeof value === 'string' && (TICKET_CATEGORIES as readonly string[]).includes(value)
}

function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 20))
  return { page, limit }
}

async function uploadAttachments(messageId: number, files: Express.Multer.File[]) {
  for (const file of files) {
    if (!isRealImage(file.buffer, file.mimetype)) continue
    const uploaded = await uploadImage(file.buffer, SUPPORT_ATTACHMENTS_FOLDER)
    await attachFileToMessage(messageId, {
      fileUrl: uploaded.url, storageKey: uploaded.storageKey, mimeType: file.mimetype, sizeBytes: file.size
    })
  }
}

supportRouter.get('/tickets', async (req, res) => {
  const { page, limit } = parsePagination(req.query as Record<string, unknown>)
  const { tickets, pagination } = await listTicketsForCustomer(req.user!.id, page, limit)
  res.json({ tickets, pagination })
})

supportRouter.post('/tickets', createTicketRateLimit, upload.array('attachments', MAX_ATTACHMENTS), async (req, res) => {
  const body = req.body as Record<string, unknown>
  const category = body.category
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber.trim() : ''

  if (!isValidCategory(category) || !subject || subject.length > MAX_SUBJECT_LENGTH || !message || message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: 'invalid_request' })
    return
  }

  let relatedOrderId: string | null = null
  if (orderNumber) {
    relatedOrderId = await findOwnedOrderId(orderNumber, req.user!.id)
    if (!relatedOrderId) {
      res.status(400).json({ error: 'order_not_found_or_not_yours' })
      return
    }
  }

  const ticket = await createTicket({ customerId: req.user!.id, category, subject, message, relatedOrderId })
  const files = (req.files as Express.Multer.File[] | undefined) ?? []
  if (files.length > 0 && imageStorageConfigured) {
    const messages = await listMessagesForCustomer(ticket.id)
    const firstMessage = messages[0]
    if (firstMessage) await uploadAttachments(firstMessage.id, files)
  }

  logEvent('support_ticket_created', { ticketId: ticket.id, customerId: req.user!.id, category })
  res.status(201).json({ ticket })
})

supportRouter.get('/tickets/:id', async (req, res) => {
  const ticket = await getTicketForCustomer(String(req.params.id), req.user!.id)
  if (!ticket) {
    res.status(404).json({ error: 'ticket_not_found' })
    return
  }
  const messages = await listMessagesForCustomer(ticket.id)
  res.json({ ticket, messages })
})

supportRouter.post('/tickets/:id/messages', replyRateLimit, upload.array('attachments', MAX_ATTACHMENTS), async (req, res) => {
  const body = req.body as Record<string, unknown>
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: 'invalid_request' })
    return
  }

  const ticketId = String(req.params.id)
  const ticketBefore = await getTicketForCustomer(ticketId, req.user!.id)
  const result = await customerReply(ticketId, req.user!.id, message)
  if ('error' in result) {
    res.status(result.error === 'ticket_not_found' ? 404 : 409).json({ error: result.error })
    return
  }

  const files = (req.files as Express.Multer.File[] | undefined) ?? []
  if (files.length > 0 && imageStorageConfigured) await uploadAttachments(result.id, files)

  if (ticketBefore?.assignedAdminId) {
    notifyAssignedAdminOfReply(ticketBefore.assignedAdminId, ticketBefore.ticketNumber).catch(() => {})
  }

  logEvent('support_ticket_customer_reply', { ticketId, customerId: req.user!.id })
  res.status(201).json({ message: result })
})
