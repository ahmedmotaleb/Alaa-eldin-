import { app } from './app.js'
import { logger, logEvent } from './logger.js'

const PORT = Number(process.env.PORT ?? 8787)

app.listen(PORT, () => {
  logEvent('server_started', { port: PORT })
})

// أي استثناء أو Promise مرفوضة برة دورة حياة طلب Express (تايمر، عملية خلفية، إلخ) ما كانش
// بيتسجّل في أي مكان قبل كده — العملية كانت بتقفل بصمت أو بستاك تريس خام على stderr بس.
// هنا بنسجّلها بنفس التنسيق البنيوي (pino) قبل الخروج، وبنسيب Railway (restartPolicy:
// ON_FAILURE) يعيد تشغيل الحاوية — فلسفة "crash-only software" بدل محاولة استمرار في حالة
// غير معروفة.
process.on('uncaughtException', (err) => {
  logger.error({ event: 'uncaught_exception', error: err.message, stack: err.stack })
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logger.error({
    event: 'unhandled_rejection',
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  })
  process.exit(1)
})
