import { Router } from 'express'
import { listPublicBanners } from '../services/bannerService.js'

export const bannersRouter = Router()

bannersRouter.get('/banners', async (_req, res) => {
  const banners = await listPublicBanners()
  res.json({ banners })
})
