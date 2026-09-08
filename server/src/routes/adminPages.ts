import { Router } from 'express'
import { requireAdmin } from '../auth.js'
import { listContentPages, getContentPageById, updateContentPage } from '../services/contentPageService.js'
import { recordAuditLog } from '../services/auditLogService.js'
import { logEvent } from '../logger.js'

export const adminPagesRouter = Router()
adminPagesRouter.use(requireAdmin)

const TITLE_MAX_LENGTH = 200
const CONTENT_MAX_LENGTH = 20000

adminPagesRouter.get('/', async (_req, res) => {
  const pages = await listContentPages()
  res.json({ pages })
})

adminPagesRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_id' })
    return
  }
  const page = await getContentPageById(id)
  if (!page) {
    res.status(404).json({ error: 'page_not_found' })
    return
  }
  res.json({ page })
})

adminPagesRouter.put('/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_id' })
    return
  }

  const existing = await getContentPageById(id)
  if (!existing) {
    res.status(404).json({ error: 'page_not_found' })
    return
  }

  const b = req.body as Record<string, unknown>
  const title = typeof b?.title === 'string' ? b.title.trim() : ''
  const content = typeof b?.content === 'string' ? b.content : ''
  const active = typeof b?.active === 'boolean' ? b.active : existing.active

  if (!title || title.length > TITLE_MAX_LENGTH || content.length > CONTENT_MAX_LENGTH) {
    res.status(400).json({ error: 'invalid_fields' })
    return
  }

  const updated = await updateContentPage(id, { title, content, active })

  logEvent('content_page_updated', { pageId: id, slug: existing.slug })
  await recordAuditLog({
    adminUserId: req.user!.id,
    action: existing.active !== active ? 'content_page_status_changed' : 'content_page_updated',
    entityType: 'content_page',
    entityId: String(id),
    oldValues: { title: existing.title, content: existing.content, active: existing.active },
    newValues: { title, content, active }
  })

  res.json({ page: updated })
})
