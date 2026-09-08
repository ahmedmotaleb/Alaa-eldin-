import { Router } from 'express'
import { requireAdmin } from '../auth.js'
import { listAuditLogs } from '../services/auditLogService.js'

export const adminAuditLogsRouter = Router()
adminAuditLogsRouter.use(requireAdmin)

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
