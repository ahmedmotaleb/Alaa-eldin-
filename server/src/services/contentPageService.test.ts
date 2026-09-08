import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { listContentPages, getContentPageById, getActiveContentPageBySlug, updateContentPage } from './contentPageService.js'

async function resetFixtures() {
  await pool.query("DELETE FROM content_pages WHERE slug LIKE 'test-%'")
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

async function insertTestPage(overrides: { slug: string, title?: string, content?: string, active?: boolean }) {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO content_pages (slug, title, content, active, sort_order) VALUES ($1, $2, $3, $4, 0) RETURNING id`,
    [overrides.slug, overrides.title ?? 'عنوان اختبار', overrides.content ?? 'محتوى اختبار', overrides.active === false ? 0 : 1]
  )
  return rows[0].id
}

describe('getActiveContentPageBySlug', () => {
  it('returns an active page', async () => {
    await insertTestPage({ slug: 'test-active', active: true })
    const page = await getActiveContentPageBySlug('test-active')
    expect(page?.slug).toBe('test-active')
  })

  it('does not return an inactive page (public visibility rule)', async () => {
    await insertTestPage({ slug: 'test-inactive', active: false })
    const page = await getActiveContentPageBySlug('test-inactive')
    expect(page).toBeUndefined()
  })

  it('returns undefined for a slug that does not exist', async () => {
    const page = await getActiveContentPageBySlug('test-does-not-exist')
    expect(page).toBeUndefined()
  })
})

describe('updateContentPage', () => {
  it('updates title, content, and active status', async () => {
    const id = await insertTestPage({ slug: 'test-update', title: 'قديم', content: 'قديم', active: true })
    const updated = await updateContentPage(id, { title: 'جديد', content: 'محتوى جديد', active: false })
    expect(updated?.title).toBe('جديد')
    expect(updated?.content).toBe('محتوى جديد')
    expect(updated?.active).toBe(false)
  })

  it('an update to active:false immediately removes it from public visibility', async () => {
    const id = await insertTestPage({ slug: 'test-toggle', active: true })
    expect(await getActiveContentPageBySlug('test-toggle')).toBeDefined()
    await updateContentPage(id, { title: 'عنوان', content: 'محتوى', active: false })
    expect(await getActiveContentPageBySlug('test-toggle')).toBeUndefined()
  })

  // مفيش أي تصيير HTML خالص لمحتوى الصفحة (لا في السيرفر ولا في الواجهة) — المحتوى بيترجع
  // نص عادي زي ما هو ومفيش أي dangerouslySetInnerHTML في مسار العرض العام، فحتى لو الأدمن
  // (مستخدم موثوق بالفعل) كتب وسوم HTML/سكريبت، بترجع كنص خام غير منفّذ أبداً.
  it('stores and returns HTML-looking content as inert plain text, never executed', async () => {
    const id = await insertTestPage({ slug: 'test-xss', active: true })
    const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>'
    await updateContentPage(id, { title: 'عنوان', content: payload, active: true })
    const page = await getActiveContentPageBySlug('test-xss')
    expect(page?.content).toBe(payload)
  })
})

describe('listContentPages / getContentPageById', () => {
  it('lists pages ordered by sort_order', async () => {
    await insertTestPage({ slug: 'test-list-a' })
    const pages = await listContentPages()
    expect(pages.some(p => p.slug === 'test-list-a')).toBe(true)
  })

  it('fetches a single page by id including inactive ones (admin view)', async () => {
    const id = await insertTestPage({ slug: 'test-admin-view', active: false })
    const page = await getContentPageById(id)
    expect(page?.slug).toBe('test-admin-view')
    expect(page?.active).toBe(false)
  })
})
