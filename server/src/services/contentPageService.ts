import { pool } from '../db.js'

export interface ContentPageRow {
  id: number
  slug: string
  title: string
  content: string
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

interface RawRow {
  id: number
  slug: string
  title: string
  content: string
  active: number
  sortOrder: number
  createdAt: string
  updatedAt: string
}

const SELECT = `
  SELECT id, slug, title, content, active, sort_order as "sortOrder",
         created_at as "createdAt", updated_at as "updatedAt"
  FROM content_pages
`

function serialize(row: RawRow): ContentPageRow {
  return { ...row, active: !!row.active }
}

export async function listContentPages(): Promise<ContentPageRow[]> {
  const { rows } = await pool.query<RawRow>(`${SELECT} ORDER BY sort_order ASC, id ASC`)
  return rows.map(serialize)
}

export async function getContentPageById(id: number): Promise<ContentPageRow | undefined> {
  const { rows } = await pool.query<RawRow>(`${SELECT} WHERE id = $1`, [id])
  return rows[0] ? serialize(rows[0]) : undefined
}

export async function getActiveContentPageBySlug(slug: string): Promise<ContentPageRow | undefined> {
  const { rows } = await pool.query<RawRow>(`${SELECT} WHERE slug = $1 AND active = 1`, [slug])
  return rows[0] ? serialize(rows[0]) : undefined
}

export async function updateContentPage(
  id: number,
  data: { title: string, content: string, active: boolean }
): Promise<ContentPageRow | undefined> {
  await pool.query(
    'UPDATE content_pages SET title = $1, content = $2, active = $3, updated_at = now() WHERE id = $4',
    [data.title, data.content, data.active ? 1 : 0, id]
  )
  return getContentPageById(id)
}
