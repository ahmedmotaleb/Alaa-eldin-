import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { getLoyaltyBalance, listLoyaltyLedger } from '../services/loyaltyService.js'
import { getOrCreateReferralCode, getReferralStats } from '../services/referralService.js'

export const loyaltyRouter = Router()
loyaltyRouter.use(requireAuth)

loyaltyRouter.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20))

  const [balance, ledger, referralCode, referralStats] = await Promise.all([
    getLoyaltyBalance(req.user!.id),
    listLoyaltyLedger(req.user!.id, page, limit),
    getOrCreateReferralCode(req.user!.id),
    getReferralStats(req.user!.id)
  ])

  res.json({
    balance,
    ledger: ledger.entries,
    page,
    limit,
    total: ledger.total,
    totalPages: Math.max(1, Math.ceil(ledger.total / limit)),
    referralCode,
    referralStats
  })
})
