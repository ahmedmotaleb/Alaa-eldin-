import { describe, expect, it, vi } from 'vitest'
import type { Response } from 'express'
import { setShortPublicCache } from './publicCache.js'

function makeRes() {
  const res: Partial<Response> = { setHeader: vi.fn() }
  return res as Response
}

describe('setShortPublicCache', () => {
  it('sets a public max-age directive', () => {
    const res = makeRes()
    setShortPublicCache(res, 60)
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=60')
  })

  it('adds stale-while-revalidate when given', () => {
    const res = makeRes()
    setShortPublicCache(res, 60, 300)
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  })
})
