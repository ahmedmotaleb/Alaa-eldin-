import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { listFavorites, addFavorite, removeFavorite } from '../services/favoriteService.js'
import { logEvent } from '../logger.js'

export const favoritesRouter = Router()
favoritesRouter.use(requireAuth)

favoritesRouter.get('/', async (req, res) => {
  const favorites = await listFavorites(req.user!.id)
  res.json({ favorites })
})

favoritesRouter.post('/:productId', async (req, res) => {
  const productId = String(req.params.productId)
  const { rows } = await pool.query('SELECT 1 FROM products WHERE id = $1', [productId])
  if (!rows[0]) {
    res.status(404).json({ error: 'product_not_found' })
    return
  }
  await addFavorite(req.user!.id, productId)
  logEvent('favorite_added', { userId: req.user!.id, productId })
  res.status(201).json({ ok: true })
})

favoritesRouter.delete('/:productId', async (req, res) => {
  await removeFavorite(req.user!.id, String(req.params.productId))
  logEvent('favorite_removed', { userId: req.user!.id, productId: String(req.params.productId) })
  res.status(204).end()
})
