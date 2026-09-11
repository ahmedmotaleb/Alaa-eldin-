import { Router } from 'express'
import { listPublicBanners } from '../services/bannerService.js'
import { setShortPublicCache } from '../publicCache.js'

export const bannersRouter = Router()

bannersRouter.get('/banners', async (_req, res) => {
  setShortPublicCache(res, 60)
  const banners = await listPublicBanners()
  res.json({ banners })
})
