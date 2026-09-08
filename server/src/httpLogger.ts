// لوجينج لطلبات /api/* فقط (method, path, status, duration, request id) — من غير ضجيج
// على كل ملف static عادي (JS/CSS/صور الواجهة).
import type { Request, Response, NextFunction } from 'express'
import { logger } from './logger.js'

export function apiRequestLogger(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api')) {
    next()
    return
  }
  const start = process.hrtime.bigint()
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000
    logger.info({
      event: 'http_request',
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100
    })
  })
  next()
}
