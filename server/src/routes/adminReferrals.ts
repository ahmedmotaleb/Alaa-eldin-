import { Router } from 'express'
import { requireAdmin, requirePermission } from '../auth.js'
import {
  listReferralsForAdmin, getReferralDetailForAdmin, getReferralAnalytics,
  type AdminReferralStatus
} from '../services/referralService.js'

export const adminReferralsRouter = Router()
adminReferralsRouter.use(requireAdmin)
adminReferralsRouter.use(requirePermission('referrals.view'))

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20
const VALID_STATUSES: AdminReferralStatus[] = ['pending', 'qualified', 'rewarded']

adminReferralsRouter.get('/analytics', async (_req, res) => {
  res.json(await getReferralAnalytics())
})

adminReferralsRouter.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT))
  const status = typeof req.query.status === 'string' && VALID_STATUSES.includes(req.query.status as AdminReferralStatus)
    ? (req.query.status as AdminReferralStatus)
    : undefined
  const search = typeof req.query.search === 'string' ? req.query.search : undefined
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined
  const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined

  const { referrals, total } = await listReferralsForAdmin({ status, search, dateFrom, dateTo, page, limit })
  res.json({ referrals, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) })
})

adminReferralsRouter.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_id' })
    return
  }
  const referral = await getReferralDetailForAdmin(id)
  if (!referral) {
    res.status(404).json({ error: 'referral_not_found' })
    return
  }
  res.json({ referral })
})
