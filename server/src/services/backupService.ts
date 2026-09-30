import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { logEvent, logError } from '../logger.js'
import { recordAuditLog } from './auditLogService.js'

const BACKUP_TIMEOUT_SECONDS = Number(process.env.BACKUP_TIMEOUT_SECONDS) || 900
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const RATE_LIMIT_MAX = 5

// قفل داخل العملية بس — كافي ومضمون هنا لأن الخدمة دايماً نسخة واحدة (numReplicas: 1 في
// إعدادات Railway الحالية)؛ لو ده اتغيّر يوماً لأكتر من نسخة، القفل ده محتاج ينتقل لقفل على
// مستوى قاعدة البيانات (pg_advisory_lock) بدل الاعتماد على الذاكرة المحلية.
let backupInProgress = false
// نفس المبدأ: عدّاد بالذاكرة لعدد المحاولات الفعلية (اللي عدّت القفل فعلاً) في آخر ساعة،
// مشترك بين المسارين (الجلسة والتوكن) عمداً — "5 في الساعة عبر الاتنين" مش لكل مسار بمفرده.
const attemptTimestamps: number[] = []

function pruneOldAttempts() {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS
  while (attemptTimestamps.length && attemptTimestamps[0] < cutoff) attemptTimestamps.shift()
}

export function isRateLimited(): boolean {
  pruneOldAttempts()
  return attemptTimestamps.length >= RATE_LIMIT_MAX
}

export function isBackupInProgress(): boolean {
  return backupInProgress
}

// للاستخدام في الاختبارات فقط — نفس مبدأ clearFrequentlyBoughtTogetherCache في
// catalogService.ts: الحالة دي بالذاكرة وعمرها ساعة كاملة عمداً (مش بيانات حساسة)، لكن ده
// يعني اختبارات متتالية في نفس العملية محتاجة تصفّيها بينها عشان حد كل اختبار يفضل مستقل.
export function resetBackupRateLimiterForTests() {
  attemptTimestamps.length = 0
  backupInProgress = false
}

function parseDatabaseUrl(databaseUrl: string) {
  const u = new URL(databaseUrl)
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, ''))
  }
}

// بيشيل أي ظهور فعلي لكلمة السر/اسم المستخدم/الرابط الكامل من نص خطأ pg_dump قبل ما نسجّله
// أو نرجّعه في أي رد — احتياط إضافي فوق إخفاء pino التلقائي للحقول المسماة "password"/"token"،
// لأن النص هنا حر (stderr خام) مش object بحقول مسماة.
function scrubSecrets(text: string): string {
  const databaseUrl = process.env.DATABASE_URL
  let out = text
  // حماية عامة أولاً — أي نص شكله "scheme://user:pass@" (بغض النظر لو طابق DATABASE_URL
  // الحالي بالظبط أو لأ، زي لو pg_dump رجّع شكل مُعاد ترميزه أو رابط وسيط مختلف) بيتشال
  // جزء الاعتماد فيه بالكامل. ده دايماً بيشتغل حتى لو DATABASE_URL نفسه مش موجود.
  out = out.replace(/([a-z][a-z0-9+.-]*):\/\/[^/@\s]+@/gi, '$1://[redacted]@')
  if (!databaseUrl) return out
  out = out.split(databaseUrl).join('[redacted]')
  try {
    const u = new URL(databaseUrl)
    if (u.password) out = out.split(decodeURIComponent(u.password)).join('[redacted]')
    if (u.username) out = out.split(decodeURIComponent(u.username)).join('[redacted]')
  } catch {
    // DATABASE_URL نفسه مش رابط صالح لسبب ما — تجاهل، النص الأصلي بيتسجّل زي ما هو
  }
  return out
}

// اسم ثابت للتطبيق في اسم الملف — نفس نمط تسمية APK أندرويد الموجود بالفعل
// (alaa-eldin-v1.0.0.apk)، مش اسم المتجر من قاعدة البيانات (ممكن يكون عربي، وغير آمن
// كـ HTTP header filename من غير ترميز إضافي).
const BACKUP_APP_NAME = 'alaa-eldin'

export function backupFilename(date: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value])) as Record<string, string>
  return `${BACKUP_APP_NAME}_${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}.dump`
}

export async function getPgDumpMajorVersion(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('pg_dump', ['--version'])
    let out = ''
    child.stdout.on('data', d => { out += d.toString() })
    child.on('error', err => reject(err))
    child.on('close', code => {
      if (code !== 0) { reject(new Error('pg_dump_version_check_failed')); return }
      const match = out.match(/(\d+)(?:\.\d+)*/)
      if (!match) { reject(new Error('pg_dump_version_unparseable')); return }
      resolve(Number(match[1]))
    })
  })
}

// صيغة server_version_num موحّدة لكل الإصدارات: قبل PostgreSQL 10 كانت MAJOR*10000 +
// MINOR*100 + PATCH (مثال 90603 = 9.6.3)، ومن 10 لفوق MAJOR*10000 + MINOR (مثال 170002 =
// 17.2) — floor(/10000) بيرجّع الـ major الصحيح في الحالتين من غير أي تفريق بينهم.
export async function getServerMajorVersion(): Promise<number> {
  const { rows } = await pool.query<{ v: string }>(`SELECT current_setting('server_version_num') as v`)
  return Math.floor(Number(rows[0].v) / 10000)
}

export interface DumpResult {
  filePath: string
  filename: string
  sizeBytes: number
  sha256: string
  durationMs: number
}

// بيعمل pg_dump فعلي لملف مؤقت أولاً (مش استريمينج مباشر للرد) — أي فشل هنا بيرمي استثناء
// قبل ما أي بايت يتبعت للعميل، ومفيش أي ملف نص مكتوب يتبعت أبداً.
export async function createDump(): Promise<DumpResult> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('database_url_missing')

  const pgEnv = parseDatabaseUrl(databaseUrl)
  const tmpFile = path.join(os.tmpdir(), `backup-${crypto.randomUUID()}.dump`)
  const timeoutMs = BACKUP_TIMEOUT_SECONDS * 1000
  const startedAt = Date.now()

  // env نظيف تماماً — مفيش أي PG* موروث من عملية السيرفر نفسها (لو حصل مصادفة)، وأي متغير
  // نظام أساسي (PATH) بس بالإضافة لمتغيرات PG* اللي بنينها إحنا من DATABASE_URL.
  const cleanEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, ...pgEnv }

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('pg_dump', ['-Fc', '--no-owner', '-f', tmpFile], { env: cleanEnv })
      let stderr = ''
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, timeoutMs)

      child.stderr.on('data', d => { stderr += d.toString() })
      child.on('error', err => {
        clearTimeout(timer)
        reject(new Error(scrubSecrets(err.message)))
      })
      child.on('close', code => {
        clearTimeout(timer)
        if (timedOut) { reject(new Error(`pg_dump timed out after ${BACKUP_TIMEOUT_SECONDS}s`)); return }
        if (code === 0) { resolve(); return }
        reject(new Error(scrubSecrets(stderr.trim() || `pg_dump exited with code ${code}`)))
      })
    })

    const stat = await fsp.stat(tmpFile)
    const sha256 = await sha256File(tmpFile)
    return {
      filePath: tmpFile,
      filename: backupFilename(),
      sizeBytes: stat.size,
      sha256,
      durationMs: Date.now() - startedAt
    }
  } catch (err) {
    await deleteTempFile(tmpFile)
    throw err
  }
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function deleteTempFile(filePath: string): Promise<void> {
  await fsp.unlink(filePath).catch(() => {})
}

export interface BackupAttemptRecord {
  actorType: 'session' | 'token'
  actorId: string
  ip: string
  success: boolean
  bytesTransferred?: number
  durationMs?: number
  failureReason?: string
}

export async function recordBackupAttempt(record: BackupAttemptRecord) {
  await recordAuditLog({
    adminUserId: record.actorType === 'session' ? record.actorId : null,
    action: 'backup_attempt',
    entityType: 'backup',
    entityId: record.actorId,
    newValues: {
      actorType: record.actorType,
      ip: record.ip,
      success: record.success,
      bytesTransferred: record.bytesTransferred ?? null,
      durationMs: record.durationMs ?? null,
      failureReason: record.failureReason ?? null
    }
  })
  if (record.success) {
    logEvent('backup_attempt_succeeded', { actorType: record.actorType, bytesTransferred: record.bytesTransferred, durationMs: record.durationMs })
  } else {
    logError('backup_attempt_failed', { actorType: record.actorType, failureReason: record.failureReason })
  }
}

export interface BackupAttemptSummary {
  id: number
  actorType: string
  adminEmail: string | null
  ip: string
  success: boolean
  bytesTransferred: number | null
  durationMs: number | null
  failureReason: string | null
  createdAt: string
}

interface AttemptRow {
  id: number
  adminEmail: string | null
  newValues: { actorType: string, ip: string, success: boolean, bytesTransferred: number | null, durationMs: number | null, failureReason: string | null }
  createdAt: string
}

export async function listRecentBackupAttempts(limit = 20): Promise<BackupAttemptSummary[]> {
  const { rows } = await pool.query<AttemptRow>(
    `SELECT a.id, u.email as "adminEmail", a.new_values as "newValues", a.created_at as "createdAt"
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.admin_user_id
     WHERE a.action = 'backup_attempt'
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $1`,
    [limit]
  )
  return rows.map(r => ({
    id: r.id,
    actorType: r.newValues.actorType,
    adminEmail: r.adminEmail,
    ip: r.newValues.ip,
    success: r.newValues.success,
    bytesTransferred: r.newValues.bytesTransferred,
    durationMs: r.newValues.durationMs,
    failureReason: r.newValues.failureReason,
    createdAt: r.createdAt
  }))
}

export async function getLastSuccessfulBackupAt(): Promise<string | null> {
  const { rows } = await pool.query<{ createdAt: string }>(
    `SELECT created_at as "createdAt" FROM audit_logs
     WHERE action = 'backup_attempt' AND (new_values->>'success')::boolean = true
     ORDER BY created_at DESC LIMIT 1`
  )
  return rows[0]?.createdAt ?? null
}

// نفّذ محاولة نسخة احتياطية كاملة: بوابة الإصدار، القفل، حد الساعة، التنفيذ الفعلي، والتدقيق.
// مشترك بين مسار الجلسة (POST /api/admin/backup/download) ومسار التوكن (GET /api/backup/dump)
// عشان ما يتكررش منطق pg_dump/القفل/الحد في المكانين.
export type BackupAttemptOutcome =
  | { status: 'version_mismatch', pgDumpMajor: number, serverMajor: number }
  | { status: 'in_progress' }
  | { status: 'rate_limited' }
  | { status: 'success', dump: DumpResult }
  | { status: 'error', message: string }

export async function attemptBackup(): Promise<BackupAttemptOutcome> {
  let pgDumpMajor: number
  let serverMajor: number
  try {
    [pgDumpMajor, serverMajor] = await Promise.all([getPgDumpMajorVersion(), getServerMajorVersion()])
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'version_check_failed' }
  }
  if (pgDumpMajor < serverMajor) {
    return { status: 'version_mismatch', pgDumpMajor, serverMajor }
  }

  if (backupInProgress) return { status: 'in_progress' }
  if (isRateLimited()) return { status: 'rate_limited' }

  backupInProgress = true
  attemptTimestamps.push(Date.now())
  try {
    const dump = await createDump()
    return { status: 'success', dump }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'backup_failed' }
  } finally {
    backupInProgress = false
  }
}
