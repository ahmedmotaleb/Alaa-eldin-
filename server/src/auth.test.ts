// اختبار وحدة على requireAdmin — نفس الـ middleware المُطبّق على كل الـ admin routers
// (بما فيها رفع الصور وسجل التدقيق)، فبيغطي "رفض المستخدم غير المصرّح له" لكل هذه الـ endpoints
// من غير ما نحتاج نشغّل سيرفر HTTP حقيقي.
import { describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { requireAdmin, requireRole, extractSessionToken } from './auth.js'
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
    const req = { user: { id: 'u1', email: 'a@a.com', fullName: 'x', createdAt: '', isAdmin: false, role: 'staff' } as AuthedUser } as Request
    const res = makeRes()
    const next = vi.fn()

    requireAdmin(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' })
    expect(next).not.toHaveBeenCalled()
  })

  it('allows an admin user through', () => {
    const req = { user: { id: 'u1', email: 'a@a.com', fullName: 'x', createdAt: '', isAdmin: true, role: 'admin' } as AuthedUser } as Request
    const res = makeRes()
    const next = vi.fn()

    requireAdmin(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })
})

describe('requireRole', () => {
  it('rejects an unauthenticated request with 401', () => {
    const req = {} as Request
    const res = makeRes()
    const next = vi.fn()

    requireRole('admin')(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'unauthorized' })
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a staff user when only admin is allowed', () => {
    const req = { user: { id: 'u1', email: 'a@a.com', fullName: 'x', createdAt: '', isAdmin: true, role: 'staff' } as AuthedUser } as Request
    const res = makeRes()
    const next = vi.fn()

    requireRole('admin')(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' })
    expect(next).not.toHaveBeenCalled()
  })

  it('allows an admin user when admin is allowed', () => {
    const req = { user: { id: 'u1', email: 'a@a.com', fullName: 'x', createdAt: '', isAdmin: true, role: 'admin' } as AuthedUser } as Request
    const res = makeRes()
    const next = vi.fn()

    requireRole('admin')(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('allows a staff user when both staff and admin are allowed', () => {
    const req = { user: { id: 'u1', email: 'a@a.com', fullName: 'x', createdAt: '', isAdmin: true, role: 'staff' } as AuthedUser } as Request
    const res = makeRes()
    const next = vi.fn()

    requireRole('staff', 'admin')(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })
})

describe('extractSessionToken', () => {
  it('reads the token from the session cookie', () => {
    const req = { cookies: { session_token: 'cookie-token-abc' } } as unknown as Request
    expect(extractSessionToken(req)).toBe('cookie-token-abc')
  })

  it('returns undefined when there is no cookie', () => {
    const req = { cookies: {} } as unknown as Request
    expect(extractSessionToken(req)).toBeUndefined()
  })
})
