import { describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { attachRequestId } from './requestId.js'

function makeRes() {
  const headers: Record<string, string> = {}
  const res: Partial<Response> = {
    setHeader: vi.fn((name: string, value: string) => { headers[name] = value; return res as Response })
  }
  return { res: res as Response, headers }
}

describe('attachRequestId', () => {
  it('generates a request id when none was supplied', () => {
    const req = { headers: {} } as unknown as Request
    const { res, headers } = makeRes()
    const next = vi.fn()

    attachRequestId(req, res, next)

    expect(req.requestId).toBeTruthy()
    expect(headers['X-Request-ID']).toBe(req.requestId)
    expect(next).toHaveBeenCalledOnce()
  })

  it('reuses an incoming X-Request-ID header instead of overwriting it', () => {
    const req = { headers: { 'x-request-id': 'incoming-id-123' } } as unknown as Request
    const { res, headers } = makeRes()
    const next = vi.fn()

    attachRequestId(req, res, next)

    expect(req.requestId).toBe('incoming-id-123')
    expect(headers['X-Request-ID']).toBe('incoming-id-123')
  })

  it('generates distinct ids across requests', () => {
    const { res: res1 } = makeRes()
    const { res: res2 } = makeRes()
    const req1 = { headers: {} } as unknown as Request
    const req2 = { headers: {} } as unknown as Request

    attachRequestId(req1, res1, vi.fn())
    attachRequestId(req2, res2, vi.fn())

    expect(req1.requestId).not.toBe(req2.requestId)
  })
})
