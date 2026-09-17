import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { upsertCartSnapshot, clearCartSnapshot, type CartSnapshotItem } from '../services/abandonedCartService.js'

export const cartSnapshotRouter = Router()
cartSnapshotRouter.use(requireAuth)

const MAX_ITEMS = 200

function parseItems(body: unknown): CartSnapshotItem[] | null {
  if (!Array.isArray(body) || body.length > MAX_ITEMS) return null
  const items: CartSnapshotItem[] = []
  for (const raw of body) {
    const r = raw as Record<string, unknown>
    if (typeof r?.productId !== 'string' || !r.productId) return null
    if (typeof r?.quantity !== 'number' || !Number.isInteger(r.quantity) || r.quantity <= 0) return null
    if (r.variantId !== undefined && typeof r.variantId !== 'string') return null
    items.push({ productId: r.productId, quantity: r.quantity, variantId: r.variantId as string | undefined })
  }
  return items
}

// السلة نفسها لسه مصدرها الوحيد للحقيقة عند الدفع (orderService.createOrder بيتحقق من كل
// حاجة تاني وقتها) — النسخة دي مجرد "مرآة" بسيطة لغرض تذكير السلة المهجورة بس، مفيش أي
// قرار سعر/مخزون بيتاخد منها مباشرة.
cartSnapshotRouter.put('/', async (req, res) => {
  const items = parseItems(req.body?.items)
  if (!items) {
    res.status(400).json({ error: 'invalid_items' })
    return
  }
  await upsertCartSnapshot(req.user!.id, items)
  res.status(204).end()
})

cartSnapshotRouter.delete('/', async (req, res) => {
  await clearCartSnapshot(req.user!.id)
  res.status(204).end()
})
