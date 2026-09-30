import { Router } from 'express'
import { verifyBackupToken } from '../services/backupTokenService.js'
import { runBackupAndRespond } from './adminBackup.js'

// مسار منفصل تماماً عن نظام الجلسات — بيتحقق من Authorization: Bearer <token> بس، ومبيقراش
// كوكي الجلسة (req.user) خالص حتى لو موجودة وصالحة. أي طلب من غير Bearer توكن صحيح هنا =
// 401، بغض النظر عن أي جلسة أدمن حقيقية مرفقة معاه. وبالعكس: توكن النسخ الاحتياطي ده مالوش
// أي تأثير في أي مسار تاني في الموقع كله — attachUser (نظام الجلسات العادي) بيقرأ بس كوكي
// الجلسة، مش هيدر Authorization، فمفيش أي احتمال يتقبل بيه حتى لو حاول حد.
// حد الساعة (5 محاولات) مُطبّق جوه attemptBackup() في backupService — مشترك فعلياً مع مسار
// الجلسة، مش حد منفصل هنا (لو اتحط حد تاني هنا بـ express-rate-limit كان هيبقى ميزانية
// مستقلة بالخطأ، عكس "5 عبر الاتنين" المطلوب بالظبط).
export const backupRouter = Router()

backupRouter.get('/dump', async (req, res) => {
  const authHeader = req.headers.authorization ?? ''
  const match = /^Bearer (.+)$/.exec(authHeader)
  if (!match) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const verified = await verifyBackupToken(match[1])
  if (!verified) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  await runBackupAndRespond(req, res, { actorType: 'token', actorId: verified.id })
})
