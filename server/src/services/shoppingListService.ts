import crypto from 'node:crypto'
import { pool } from '../db.js'
import { resolveProducts, type ProductCard } from './catalogService.js'

export interface ShoppingList {
  id: string
  name: string
  itemCount: number
  createdAt: string
  updatedAt: string
}

export interface ShoppingListItem {
  productId: string
  quantity: number
  product: ProductCard | null
}

const MAX_LISTS_PER_USER = 30
const MAX_NAME_LENGTH = 60

export async function listShoppingLists(userId: string): Promise<ShoppingList[]> {
  const { rows } = await pool.query<{ id: string; name: string; itemCount: string; createdAt: string; updatedAt: string }>(
    `SELECT sl.id, sl.name, sl.created_at as "createdAt", sl.updated_at as "updatedAt",
            COUNT(sli.id) as "itemCount"
     FROM shopping_lists sl
     LEFT JOIN shopping_list_items sli ON sli.list_id = sl.id
     WHERE sl.user_id = $1
     GROUP BY sl.id
     ORDER BY sl.updated_at DESC`,
    [userId]
  )
  return rows.map(r => ({ ...r, itemCount: Number(r.itemCount) }))
}

async function getOwnedList(userId: string, listId: string): Promise<{ id: string } | null> {
  const { rows } = await pool.query('SELECT id FROM shopping_lists WHERE id = $1 AND user_id = $2', [listId, userId])
  return rows[0] ?? null
}

export async function createShoppingList(userId: string, name: string): Promise<{ error: 'too_many_lists' } | ShoppingList> {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH)
  const { rows: countRows } = await pool.query<{ n: string }>('SELECT COUNT(*) as n FROM shopping_lists WHERE user_id = $1', [userId])
  if (Number(countRows[0].n) >= MAX_LISTS_PER_USER) return { error: 'too_many_lists' }

  const id = crypto.randomUUID()
  await pool.query(
    'INSERT INTO shopping_lists (id, user_id, name) VALUES ($1, $2, $3)',
    [id, userId, trimmed]
  )
  return { id, name: trimmed, itemCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
}

export async function renameShoppingList(userId: string, listId: string, name: string): Promise<{ error: 'not_found' } | { ok: true }> {
  const result = await pool.query(
    'UPDATE shopping_lists SET name = $1, updated_at = now() WHERE id = $2 AND user_id = $3',
    [name.trim().slice(0, MAX_NAME_LENGTH), listId, userId]
  )
  if (result.rowCount === 0) return { error: 'not_found' }
  return { ok: true }
}

export async function deleteShoppingList(userId: string, listId: string): Promise<void> {
  await pool.query('DELETE FROM shopping_lists WHERE id = $1 AND user_id = $2', [listId, userId])
}

// بيرجّع بيانات المنتج الحالية (سعر/توفر) لكل صنف، مش نسخة قديمة وقت الإضافة للقائمة — نفس
// فلسفة listFavorites/listFrequentlyPurchased. منتج غير متاح حالياً (available:false) بيفضل
// ظاهر في القائمة (مش بيتشال)، عشان العميل يعرف إنه كان ناوي يشتريه؛ منتج اتشال فعلياً من
// الكتالوج بيتشال صفه من shopping_list_items تلقائياً (ON DELETE CASCADE)، فـ product أبداً
// مش هيرجع null هنا عملياً — الـ null مجرد أمان في النوع لأي حالة سباق نظرية.
export async function getShoppingListItems(userId: string, listId: string): Promise<{ error: 'not_found' } | { list: { id: string; name: string }; items: ShoppingListItem[] }> {
  const list = await getOwnedList(userId, listId)
  if (!list) return { error: 'not_found' }

  const { rows } = await pool.query<{ productId: string; quantity: number }>(
    'SELECT product_id as "productId", quantity FROM shopping_list_items WHERE list_id = $1 ORDER BY created_at ASC',
    [listId]
  )
  const resolved = await resolveProducts(rows.map(r => r.productId))
  const byId = new Map(resolved.map(p => [p.id, p]))

  const { rows: nameRows } = await pool.query<{ name: string }>('SELECT name FROM shopping_lists WHERE id = $1', [listId])

  return {
    list: { id: listId, name: nameRows[0].name },
    items: rows.map(r => ({ productId: r.productId, quantity: r.quantity, product: byId.get(r.productId) ?? null }))
  }
}

export async function addOrUpdateShoppingListItem(
  userId: string, listId: string, productId: string, quantity: number
): Promise<{ error: 'not_found' | 'product_not_found' } | { ok: true }> {
  const list = await getOwnedList(userId, listId)
  if (!list) return { error: 'not_found' }

  const { rows: productRows } = await pool.query('SELECT 1 FROM products WHERE id = $1', [productId])
  if (!productRows[0]) return { error: 'product_not_found' }

  const id = crypto.randomUUID()
  await pool.query(
    `INSERT INTO shopping_list_items (id, list_id, product_id, quantity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (list_id, product_id) DO UPDATE SET quantity = $4`,
    [id, listId, productId, quantity]
  )
  await pool.query('UPDATE shopping_lists SET updated_at = now() WHERE id = $1', [listId])
  return { ok: true }
}

export async function removeShoppingListItem(userId: string, listId: string, productId: string): Promise<{ error: 'not_found' } | { ok: true }> {
  const list = await getOwnedList(userId, listId)
  if (!list) return { error: 'not_found' }

  await pool.query('DELETE FROM shopping_list_items WHERE list_id = $1 AND product_id = $2', [listId, productId])
  await pool.query('UPDATE shopping_lists SET updated_at = now() WHERE id = $1', [listId])
  return { ok: true }
}
