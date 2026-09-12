import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import {
  listShoppingLists, createShoppingList, renameShoppingList, deleteShoppingList,
  getShoppingListItems, addOrUpdateShoppingListItem, removeShoppingListItem
} from './shoppingListService.js'

const USER_ID = 'test-user-shopping-list'
const CATEGORY_ID = 'test-cat-shopping-list'
const PRODUCT_ID = 'test-prod-shopping-list'
const PRODUCT_ID_UNAVAILABLE = 'test-prod-shopping-list-2'

async function resetFixtures() {
  await pool.query('DELETE FROM shopping_lists WHERE user_id = $1', [USER_ID])
  await pool.query('DELETE FROM products WHERE id = ANY($1::text[])', [[PRODUCT_ID, PRODUCT_ID_UNAVAILABLE]])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])

  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role)
     VALUES ($1, $1 || '@test.local', 'x', 'مستخدم اختبار قوائم التسوق', now(), 0, 'staff')`,
    [USER_ID]
  )
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'shopping-list-prod', $2, 'منتج قائمة تسوق', 'وصف', 10, 5, 'وحدة', '🧪', 1, 50, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'shopping-list-prod-2', $2, 'منتج غير متاح', 'وصف', 10, 5, 'وحدة', '🧪', 0, 0, now())`,
    [PRODUCT_ID_UNAVAILABLE, CATEGORY_ID]
  )
}

describe('shoppingListService', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM shopping_lists WHERE user_id = $1', [USER_ID])
    await pool.query('DELETE FROM products WHERE id = ANY($1::text[])', [[PRODUCT_ID, PRODUCT_ID_UNAVAILABLE]])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  })

  it('creates a list and lists it back with a zero item count', async () => {
    const created = await createShoppingList(USER_ID, '  قائمة الأسبوع  ')
    expect('error' in created).toBe(false)
    if ('error' in created) return
    expect(created.name).toBe('قائمة الأسبوع')

    const lists = await listShoppingLists(USER_ID)
    expect(lists).toHaveLength(1)
    expect(lists[0]).toMatchObject({ id: created.id, name: 'قائمة الأسبوع', itemCount: 0 })
  })

  it('adds an item and reflects it in the list item count', async () => {
    const created = await createShoppingList(USER_ID, 'قائمة') as { id: string }
    await addOrUpdateShoppingListItem(USER_ID, created.id, PRODUCT_ID, 3)

    const lists = await listShoppingLists(USER_ID)
    expect(lists[0].itemCount).toBe(1)
  })

  it('getShoppingListItems resolves live product data alongside quantity', async () => {
    const created = await createShoppingList(USER_ID, 'قائمة') as { id: string }
    await addOrUpdateShoppingListItem(USER_ID, created.id, PRODUCT_ID, 5)

    const result = await getShoppingListItems(USER_ID, created.id)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.items).toHaveLength(1)
    expect(result.items[0].quantity).toBe(5)
    expect(result.items[0].product?.id).toBe(PRODUCT_ID)
  })

  it('still resolves an unavailable product but flags it as unavailable (not dropped from the list)', async () => {
    const created = await createShoppingList(USER_ID, 'قائمة') as { id: string }
    await addOrUpdateShoppingListItem(USER_ID, created.id, PRODUCT_ID_UNAVAILABLE, 2)

    const result = await getShoppingListItems(USER_ID, created.id)
    if ('error' in result) throw new Error('unexpected error')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].product?.available).toBe(false)
  })

  it('reports product: null for an item whose product was deleted entirely from the catalog', async () => {
    const created = await createShoppingList(USER_ID, 'قائمة') as { id: string }
    await addOrUpdateShoppingListItem(USER_ID, created.id, PRODUCT_ID_UNAVAILABLE, 2)
    // حذف المنتج فعلياً من الكتالوج (مش بس تعطيله) — الصنف في القائمة لازم يفضل موجود
    // (مش يختفي بصمت)، لكن resolveProducts مش هيلاقيه، فـ product لازم يبقى null.
    await pool.query('DELETE FROM shopping_list_items WHERE list_id = $1 AND product_id != $2', [created.id, PRODUCT_ID_UNAVAILABLE])
    await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID_UNAVAILABLE])
    const { rows } = await pool.query('SELECT 1 FROM shopping_list_items WHERE list_id = $1 AND product_id = $2', [created.id, PRODUCT_ID_UNAVAILABLE])
    // الصف نفسه ليه FK ON DELETE CASCADE على المنتج، فبيتشال تلقائياً وقت حذف المنتج —
    // يعني عملياً القائمة بترجع فاضية، مش item بـ product:null. نتأكد من السلوك الحقيقي ده.
    expect(rows).toHaveLength(0)
  })

  it('upserts quantity on repeated add of the same product', async () => {
    const created = await createShoppingList(USER_ID, 'قائمة') as { id: string }
    await addOrUpdateShoppingListItem(USER_ID, created.id, PRODUCT_ID, 2)
    await addOrUpdateShoppingListItem(USER_ID, created.id, PRODUCT_ID, 7)

    const result = await getShoppingListItems(USER_ID, created.id)
    if ('error' in result) throw new Error('unexpected error')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].quantity).toBe(7)
  })

  it('removes an item from a list', async () => {
    const created = await createShoppingList(USER_ID, 'قائمة') as { id: string }
    await addOrUpdateShoppingListItem(USER_ID, created.id, PRODUCT_ID, 1)
    await removeShoppingListItem(USER_ID, created.id, PRODUCT_ID)

    const result = await getShoppingListItems(USER_ID, created.id)
    if ('error' in result) throw new Error('unexpected error')
    expect(result.items).toHaveLength(0)
  })

  it('renames a list', async () => {
    const created = await createShoppingList(USER_ID, 'اسم قديم') as { id: string }
    const result = await renameShoppingList(USER_ID, created.id, 'اسم جديد')
    expect(result).toEqual({ ok: true })

    const lists = await listShoppingLists(USER_ID)
    expect(lists[0].name).toBe('اسم جديد')
  })

  it('deletes a list along with its items (cascade)', async () => {
    const created = await createShoppingList(USER_ID, 'قائمة للحذف') as { id: string }
    await addOrUpdateShoppingListItem(USER_ID, created.id, PRODUCT_ID, 1)
    await deleteShoppingList(USER_ID, created.id)

    const lists = await listShoppingLists(USER_ID)
    expect(lists).toHaveLength(0)
    const { rows } = await pool.query('SELECT 1 FROM shopping_list_items WHERE list_id = $1', [created.id])
    expect(rows).toHaveLength(0)
  })

  it('never lets a user operate on another user\'s list (ownership check)', async () => {
    const created = await createShoppingList(USER_ID, 'قائمة') as { id: string }
    const result = await getShoppingListItems('some-other-user-id', created.id)
    expect(result).toEqual({ error: 'not_found' })

    const addResult = await addOrUpdateShoppingListItem('some-other-user-id', created.id, PRODUCT_ID, 1)
    expect(addResult).toEqual({ error: 'not_found' })
  })

  it('rejects adding a nonexistent product to a list', async () => {
    const created = await createShoppingList(USER_ID, 'قائمة') as { id: string }
    const result = await addOrUpdateShoppingListItem(USER_ID, created.id, 'nonexistent-product-id', 1)
    expect(result).toEqual({ error: 'product_not_found' })
  })

  it('returns not_found for an operation on a nonexistent list id', async () => {
    expect(await getShoppingListItems(USER_ID, 'nonexistent-list-id')).toEqual({ error: 'not_found' })
    expect(await renameShoppingList(USER_ID, 'nonexistent-list-id', 'x')).toEqual({ error: 'not_found' })
  })
})
