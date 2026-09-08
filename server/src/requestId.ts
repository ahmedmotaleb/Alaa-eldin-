// يولّد X-Request-ID لكل طلب (أو بيستخدم اللي جايله من proxy لو موجود) عشان نقدر نربط
// بين سطر لوج الطلب وأي خطأ حصل أثناء معالجته، وبيرجعه في الاستجابة كمان.
import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string
    }
  }
}

export function attachRequestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id']
  const id = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : crypto.randomUUID()
  req.requestId = id
  res.setHeader('X-Request-ID', id)
  next()
}
