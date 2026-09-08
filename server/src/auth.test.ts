// اختبار وحدة على requireAdmin — نفس الـ middleware المُطبّق على كل الـ admin routers
// (بما فيها رفع الصور وسجل التدقيق)، فبيغطي "رفض المستخدم غير المصرّح له" لكل هذه الـ endpoints
// من غير ما نحتاج نشغّل سيرفر HTTP حقيقي.
import { describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { requireAdmin } from './auth.js'
import type { AuthedUser } from './auth.js'

function makeRes() {
  const res: Partial<Response> = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res as Response
}

describe('requireAdmin', () => {
  it('rejects an unauthenticated request with 401', () => {
    const req = {} as Request
    const res = makeRes()
    const next = vi.fn()

    requireAdmin(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'unauthorized' })
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a logged-in non-admin user with 403', () => {
    const req = { user: { id: 'u1', email: 'a@a.com', fullName: 'x', createdAt: '', isAdmin: false } as AuthedUser } as Request
    const res = makeRes()
    const next = vi.fn()

    requireAdmin(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' })
    expect(next).not.toHaveBeenCalled()
  })

  it('allows an admin user through', () => {
    const req = { user: { id: 'u1', email: 'a@a.com', fullName: 'x', createdAt: '', isAdmin: true } as AuthedUser } as Request
    const res = makeRes()
    const next = vi.fn()

    requireAdmin(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })
})
