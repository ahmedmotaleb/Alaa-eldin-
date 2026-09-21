import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAdmin } from '../auth.js'
import { getUserPermissions } from '../services/permissionService.js'
import { globalSearch, ALL_SEARCH_ENTITY_TYPES, MIN_QUERY_LENGTH, type SearchEntityType } from '../services/globalSearchService.js'

export const adminSearchRouter = Router()
adminSearchRouter.use(requireAdmin)

// حتى لو الاستعلامات نفسها رخيصة (LIMIT 5 لكل نوع + فهارس trgm)، البحث الشامل قابل للطلب
// بمعدل عالي جداً من واجهة تكتب حرف بحرف — تحديد معدل معقول (60 طلب/دقيقة) يمنع أي إساءة
// استخدام آلي بدون ما يعطّل تجربة الكتابة العادية.
const searchRateLimit = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false })

function parseRequestedTypes(raw: unknown): SearchEntityType[] {
  if (typeof raw !== 'string' || !raw.trim()) return ALL_SEARCH_ENTITY_TYPES
  const requested = raw.split(',').map(t => t.trim())
  const valid = requested.filter((t): t is SearchEntityType => (ALL_SEARCH_ENTITY_TYPES as string[]).includes(t))
  return valid.length > 0 ? valid : ALL_SEARCH_ENTITY_TYPES
}

adminSearchRouter.get('/', searchRateLimit, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (q.length < MIN_QUERY_LENGTH) {
    res.json({ results: {} })
    return
  }

  const requestedTypes = parseRequestedTypes(req.query.types)
  const permissions = await getUserPermissions(req.user!)
  const results = await globalSearch(q, requestedTypes, permissions)
  res.json({ results })
})
