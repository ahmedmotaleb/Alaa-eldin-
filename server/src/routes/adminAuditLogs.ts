import { Router } from 'express'
import { requireAdmin, requireRole } from '../auth.js'
import { listAuditLogs } from '../services/auditLogService.js'

// سجل النشاط بيكشف كل إجراءات المديرين (بما فيها بعض) — مقصور على دور 'admin' الكامل بس.
export const adminAuditLogsRouter = Router()
adminAuditLogsRouter.use(requireAdmin)
adminAuditLogsRouter.use(requireRole('admin'))

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

adminAuditLogsRouter.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT))

  const { rows, total } = await listAuditLogs({ page, limit })
  res.json({
    logs: rows,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  })
})
