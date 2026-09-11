import { Router } from 'express'
import { getActiveContentPageBySlug } from '../services/contentPageService.js'
import { setShortPublicCache } from '../publicCache.js'

export const pagesRouter = Router()

// عام بدون مصادقة — يرجّع الصفحة النشطة بس، وبيانات الواجهة فقط (id/slug/title/content)
// من غير أي بيانات إدارية زي updatedAt الداخلية أو حالة active نفسها.
pagesRouter.get('/pages/:slug', async (req, res) => {
  // صفحات محتوى (سياسة الاسترجاع...إلخ) بتتغيّر نادر جداً — كاش أطول شوية من الأقسام/الإعدادات.
  setShortPublicCache(res, 300)
  const page = await getActiveContentPageBySlug(String(req.params.slug))
  if (!page) {
    res.status(404).json({ error: 'page_not_found' })
    return
  }
  res.json({ page: { slug: page.slug, title: page.title, content: page.content } })
})
