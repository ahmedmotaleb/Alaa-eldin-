import type { PoolClient } from 'pg'
import { withTransaction } from '../db.js'
import { computeLineTotal } from './pricingService.js'
import { applySubstitutionStockMove } from './inventoryService.js'
import { logEvent } from '../logger.js'

export type ProposeSubstitutionError =
  | 'order_not_found' | 'item_not_found' | 'item_not_pending' | 'preference_forbids_substitution'
  | 'replacement_product_not_found' | 'replacement_unavailable' | 'invalid_quantity'
  | 'insufficient_stock' | 'cannot_replace_with_same_product'

export type RespondSubstitutionError =
  | 'order_not_found' | 'item_not_found' | 'no_pending_substitution'
  | 'replacement_unavailable' | 'insufficient_stock'

interface LockedItem {
  id: number
  orderId: string
  productId: string
  quantity: number
  pickedStatus: string
  substitutionStatus: string
}

interface LockedReplacementProduct {
  id: string
  name: string
  unit: string
  price: number
  available: boolean
  stock: number
}

async function lockItem(client: PoolClient, orderId: string, itemId: number): Promise<LockedItem | null> {
  const { rows } = await client.query<LockedItem>(
    `SELECT id, order_id as "orderId", product_id as "productId", quantity,
            picked_status as "pickedStatus", substitution_status as "substitutionStatus"
     FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE`,
    [itemId, orderId]
  )
  return rows[0] ?? null
}

async function lockReplacementProduct(client: PoolClient, productId: string): Promise<LockedReplacementProduct | null> {
  const { rows } = await client.query<{ id: string, name: string, unit: string, price: number, available: number, stock: number }>(
    'SELECT id, name, unit, price, available, stock FROM products WHERE id = $1 FOR UPDATE',
    [productId]
  )
  const row = rows[0]
  if (!row) return null
  return { id: row.id, name: row.name, unit: row.unit, price: row.price, available: !!row.available, stock: row.stock }
}

// اعتماد فعلي (تلقائي أو بموافقة العميل): بيستخدم بيانات المنتج البديل *الحيّة وقت الاعتماد
// نفسه* (مش اللقطة المعروضة وقت الاقتراح) — نفس مبدأ إعادة التحقق من السعر/التوفر وقت أي
// عملية بيع فعلية، بدل الاعتماد على قيمة ممكن تكون اتغيّرت من وقت الاقتراح لحد الموافقة.
async function finalizeApproval(client: PoolClient, item: LockedItem, replacement: LockedReplacementProduct, quantity: number): Promise<void> {
  const lineTotal = computeLineTotal(replacement.price, quantity)
  await applySubstitutionStockMove(client, item.orderId, item.productId, item.quantity, replacement.id, quantity)
  await client.query(
    `UPDATE order_items SET
       picked_status = 'substituted', substitution_status = 'approved',
       replacement_product_id = $1, replacement_name = $2, replacement_unit = $3,
       replacement_quantity = $4, replacement_unit_price = $5, replacement_line_total = $6,
       substitution_decided_at = now()
     WHERE id = $7`,
    [replacement.id, replacement.name, replacement.unit, quantity, replacement.price, lineTotal, item.id]
  )
}

export async function proposeSubstitution(
  orderId: string,
  itemId: number,
  replacementProductId: string,
  replacementQuantity: number,
  proposedByUserId: string
): Promise<{ ok: true, status: 'proposed' | 'approved' } | { ok: false, error: ProposeSubstitutionError }> {
  return withTransaction(async client => {
    const { rows: orderRows } = await client.query<{ substitutionPreference: string }>(
      'SELECT substitution_preference as "substitutionPreference" FROM orders WHERE id = $1 FOR UPDATE',
      [orderId]
    )
    const order = orderRows[0]
    if (!order) return { ok: false, error: 'order_not_found' }

    const item = await lockItem(client, orderId, itemId)
    if (!item) return { ok: false, error: 'item_not_found' }
    if (item.pickedStatus !== 'pending' || item.substitutionStatus !== 'none') return { ok: false, error: 'item_not_pending' }
    if (order.substitutionPreference === 'remove_item') return { ok: false, error: 'preference_forbids_substitution' }

    if (!Number.isInteger(replacementQuantity) || replacementQuantity <= 0) return { ok: false, error: 'invalid_quantity' }
    if (replacementProductId === item.productId) return { ok: false, error: 'cannot_replace_with_same_product' }

    const replacement = await lockReplacementProduct(client, replacementProductId)
    if (!replacement) return { ok: false, error: 'replacement_product_not_found' }
    if (!replacement.available) return { ok: false, error: 'replacement_unavailable' }

    if (order.substitutionPreference === 'replace_similar') {
      if (replacement.stock < replacementQuantity) return { ok: false, error: 'insufficient_stock' }
      await finalizeApproval(client, item, replacement, replacementQuantity)
      await client.query(
        'UPDATE order_items SET substitution_proposed_by_user_id = $1, substitution_proposed_at = now() WHERE id = $2',
        [proposedByUserId, item.id]
      )
      logEvent('substitution_approved', { orderId, itemId, replacementProductId, auto: true })
      return { ok: true, status: 'approved' }
    }

    // contact_me: لسه محتاج موافقة العميل — مفيش أي خصم مخزون أو تعديل مالي دلوقتي، مجرد
    // اقتراح مسجّل لحد ما يتقرر مصيره (approve/reject).
    const lineTotal = computeLineTotal(replacement.price, replacementQuantity)
    await client.query(
      `UPDATE order_items SET
         substitution_status = 'proposed', replacement_product_id = $1, replacement_name = $2,
         replacement_unit = $3, replacement_quantity = $4, replacement_unit_price = $5,
         replacement_line_total = $6, substitution_proposed_by_user_id = $7, substitution_proposed_at = now()
       WHERE id = $8`,
      [replacement.id, replacement.name, replacement.unit, replacementQuantity, replacement.price, lineTotal, proposedByUserId, item.id]
    )
    logEvent('substitution_proposed', { orderId, itemId, replacementProductId })
    return { ok: true, status: 'proposed' }
  })
}

export async function respondToSubstitution(
  orderId: string,
  itemId: number,
  decision: 'approved' | 'rejected'
): Promise<{ ok: true } | { ok: false, error: RespondSubstitutionError }> {
  return withTransaction(async client => {
    const item = await lockItem(client, orderId, itemId)
    if (!item) return { ok: false, error: 'item_not_found' }
    if (item.substitutionStatus !== 'proposed') return { ok: false, error: 'no_pending_substitution' }

    if (decision === 'rejected') {
      await client.query(
        `UPDATE order_items SET picked_status = 'unavailable', substitution_status = 'rejected', substitution_decided_at = now() WHERE id = $1`,
        [item.id]
      )
      logEvent('substitution_rejected', { orderId, itemId })
      return { ok: true }
    }

    const { rows } = await client.query<{ replacementProductId: string, replacementQuantity: number }>(
      'SELECT replacement_product_id as "replacementProductId", replacement_quantity as "replacementQuantity" FROM order_items WHERE id = $1',
      [item.id]
    )
    const proposal = rows[0]
    const replacement = await lockReplacementProduct(client, proposal.replacementProductId)
    if (!replacement || !replacement.available) return { ok: false, error: 'replacement_unavailable' }
    if (replacement.stock < proposal.replacementQuantity) return { ok: false, error: 'insufficient_stock' }

    await finalizeApproval(client, item, replacement, proposal.replacementQuantity)
    logEvent('substitution_approved', { orderId, itemId, auto: false })
    return { ok: true }
  })
}

// نقطة مشتركة للعميل (سواء مسجّل دخول أو زائر بتوكن) — الطلب نفسه بالفعل اتأكّد امتلاكه
// (ownership الجلسة أو guest token) قبل ما توصل هنا؛ هنا بس بيتأكد إن item_id فعلاً تابع
// لنفس الطلب (مش أي id عشوائي) قبل تمرير القرار لـ respondToSubstitution.
export async function respondToSubstitutionForOwnedOrder(
  order: { id: string, items: { id: number }[] },
  itemIdInput: unknown,
  decisionInput: unknown
): Promise<{ ok: true } | { ok: false, status: number, body: { error: string } }> {
  const itemId = Number(itemIdInput)
  if (!Number.isInteger(itemId) || (decisionInput !== 'approved' && decisionInput !== 'rejected')) {
    return { ok: false, status: 400, body: { error: 'invalid_request' } }
  }
  if (!order.items.some(i => i.id === itemId)) {
    return { ok: false, status: 404, body: { error: 'item_not_found' } }
  }

  const result = await respondToSubstitution(order.id, itemId, decisionInput)
  if (!result.ok) {
    return { ok: false, status: result.error === 'no_pending_substitution' ? 409 : 404, body: { error: result.error } }
  }
  return { ok: true }
}
