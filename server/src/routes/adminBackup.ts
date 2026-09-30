import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin, requirePermission, verifyPassword } from '../auth.js'
import { logEvent, logError } from '../logger.js'
import {
  attemptBackup, deleteTempFile, recordBackupAttempt, getPgDumpMajorVersion, getServerMajorVersion,
  listRecentBackupAttempts, getLastSuccessfulBackupAt
} from '../services/backupService.js'
import { listBackupTokens, createBackupToken, revokeBackupToken } from '../services/backupTokenService.js'

export const adminBackupRouter = Router()
adminBackupRouter.use(requireAdmin)

async function getPasswordHash(userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ passwordHash: string }>('SELECT password_hash as "passwordHash" FROM users WHERE id = $1', [userId])
  return rows[0]?.passwordHash ?? null
}

// حالة الإصدارات + آخر نسخة احتياطية ناجحة — للوحة الإدارة، بدون أي محاولة نسخ فعلية.
adminBackupRouter.get('/status', requirePermission('backups.manage'), async (_req, res) => {
  const [pgDumpMajor, serverMajor, lastSuccessfulBackupAt] = await Promise.all([
    getPgDumpMajorVersion().catch(() => null),
    getServerMajorVersion().catch(() => null),
    getLastSuccessfulBackupAt()
  ])
  res.json({ pgDumpMajor, serverMajor, lastSuccessfulBackupAt })
})

adminBackupRouter.get('/attempts', requirePermission('backups.manage'), async (_req, res) => {
  res.json({ attempts: await listRecentBackupAttempts(20) })
})

// تحميل عبر المتصفح — جلسة أدمن + كلمة السر تُكتب تاني (مفيش أي اعتماد على الجلسة لوحدها
// لفتح دامب قاعدة بيانات كامل). نفس منطق pg_dump/القفل/الحد المشترك مع مسار التوكن.
adminBackupRouter.post('/download', requirePermission('backups.manage'), async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!password) {
    res.status(400).json({ error: 'password_required' })
    return
  }
  const passwordHash = await getPasswordHash(req.user!.id)
  if (!passwordHash || !verifyPassword(password, passwordHash)) {
    res.status(401).json({ error: 'invalid_password' })
    return
  }

  await runBackupAndRespond(req, res, { actorType: 'session', actorId: req.user!.id })
})

adminBackupRouter.get('/tokens', requirePermission('backups.manage'), async (_req, res) => {
  res.json({ tokens: await listBackupTokens() })
})

adminBackupRouter.post('/tokens', requirePermission('backups.manage'), async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!name || !password) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }
  const passwordHash = await getPasswordHash(req.user!.id)
  if (!passwordHash || !verifyPassword(password, passwordHash)) {
    res.status(401).json({ error: 'invalid_password' })
    return
  }

  const { id, token } = await createBackupToken({ name, createdBy: req.user!.id })
  logEvent('backup_token_created', { tokenId: id, createdBy: req.user!.id })
  // التوكن الخام بيترجع في الرد ده مرة واحدة بس — مفيش أي مسار تاني (ولا أي لوج) بيرجّعه تاني.
  res.status(201).json({ id, token })
})

// إلغاء توكن ما بيحتاجش كلمة سر عمداً (نفس قرارك) — أسرع طريقة لقفل توكن مسروق/مش محتاجينه.
adminBackupRouter.delete('/tokens/:id', requirePermission('backups.manage'), async (req, res) => {
  const tokenId = String(req.params.id)
  const revoked = await revokeBackupToken(tokenId)
  if (!revoked) {
    res.status(404).json({ error: 'token_not_found' })
    return
  }
  logEvent('backup_token_revoked', { tokenId, revokedBy: req.user!.id })
  res.status(204).end()
})

// منطق التنفيذ والرد الفعلي مشترك — بيتصدّر عشان مسار التوكن (backup.ts) يستخدمه بنفس
// الضبط (نفس الهيدرز، نفس سلوك الحذف، نفس شكل التدقيق) من غير تكرار.
export async function runBackupAndRespond(
  req: import('express').Request,
  res: import('express').Response,
  actor: { actorType: 'session' | 'token', actorId: string }
) {
  const ip = req.ip ?? 'unknown'
  const outcome = await attemptBackup()

  switch (outcome.status) {
    case 'version_mismatch': {
      await recordBackupAttempt({ ...actor, ip, success: false, failureReason: `pg_dump ${outcome.pgDumpMajor} is older than server ${outcome.serverMajor}` })
      res.status(503).json({ error: 'pg_dump_version_too_old', pgDumpMajor: outcome.pgDumpMajor, serverMajor: outcome.serverMajor })
      return
    }
    case 'in_progress': {
      await recordBackupAttempt({ ...actor, ip, success: false, failureReason: 'backup_already_in_progress' })
      res.status(409).json({ error: 'backup_already_in_progress' })
      return
    }
    case 'rate_limited': {
      await recordBackupAttempt({ ...actor, ip, success: false, failureReason: 'rate_limited' })
      res.status(429).json({ error: 'rate_limited' })
      return
    }
    case 'error': {
      logError('backup_attempt_failed', { actorType: actor.actorType, failureReason: outcome.message })
      await recordBackupAttempt({ ...actor, ip, success: false, failureReason: outcome.message })
      res.status(500).json({ error: 'backup_failed' })
      return
    }
    case 'success': {
      const { dump } = outcome
      let bytesSent = 0
      res.status(200)
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Disposition', `attachment; filename="${dump.filename}"`)
      res.setHeader('Content-Length', String(dump.sizeBytes))
      res.setHeader('X-Backup-SHA256', dump.sha256)

      const { createReadStream } = await import('node:fs')
      const stream = createReadStream(dump.filePath)
      stream.on('data', chunk => { bytesSent += chunk.length })

      let settled = false
      const finish = async (success: boolean, failureReason?: string) => {
        if (settled) return
        settled = true
        await deleteTempFile(dump.filePath)
        await recordBackupAttempt({
          ...actor, ip, success,
          bytesTransferred: bytesSent, durationMs: dump.durationMs, failureReason
        })
      }

      stream.on('error', async err => {
        await finish(false, err.message)
        if (!res.headersSent) res.status(500).json({ error: 'stream_failed' })
        else res.destroy()
      })
      res.on('finish', () => { finish(true) })
      res.on('close', () => {
        if (!settled) finish(false, 'connection_closed_before_completion')
      })

      stream.pipe(res)
    }
  }
}
