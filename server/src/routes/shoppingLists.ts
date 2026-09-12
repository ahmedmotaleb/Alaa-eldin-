import { Router } from 'express'
import { requireAuth } from '../auth.js'
import {
  listShoppingLists, createShoppingList, renameShoppingList, deleteShoppingList,
  getShoppingListItems, addOrUpdateShoppingListItem, removeShoppingListItem
} from '../services/shoppingListService.js'

export const shoppingListsRouter = Router()
shoppingListsRouter.use(requireAuth)

shoppingListsRouter.get('/', async (req, res) => {
  const lists = await listShoppingLists(req.user!.id)
  res.json({ lists })
})

shoppingListsRouter.post('/', async (req, res) => {
  const name = req.body?.name
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'missing_name' })
    return
  }
  const result = await createShoppingList(req.user!.id, name)
  if ('error' in result) {
    res.status(409).json({ error: result.error })
    return
  }
  res.status(201).json({ list: result })
})

shoppingListsRouter.get('/:id', async (req, res) => {
  const result = await getShoppingListItems(req.user!.id, String(req.params.id))
  if ('error' in result) {
    res.status(404).json({ error: result.error })
    return
  }
  res.json(result)
})

shoppingListsRouter.patch('/:id', async (req, res) => {
  const name = req.body?.name
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'missing_name' })
    return
  }
  const result = await renameShoppingList(req.user!.id, String(req.params.id), name)
  if ('error' in result) {
    res.status(404).json({ error: result.error })
    return
  }
  res.status(204).end()
})

shoppingListsRouter.delete('/:id', async (req, res) => {
  await deleteShoppingList(req.user!.id, String(req.params.id))
  res.status(204).end()
})

shoppingListsRouter.put('/:id/items/:productId', async (req, res) => {
  const quantity = req.body?.quantity
  if (typeof quantity !== 'number' || quantity <= 0 || !Number.isInteger(quantity)) {
    res.status(400).json({ error: 'invalid_quantity' })
    return
  }
  const result = await addOrUpdateShoppingListItem(req.user!.id, String(req.params.id), String(req.params.productId), quantity)
  if ('error' in result) {
    res.status(404).json({ error: result.error })
    return
  }
  res.status(204).end()
})

shoppingListsRouter.delete('/:id/items/:productId', async (req, res) => {
  const result = await removeShoppingListItem(req.user!.id, String(req.params.id), String(req.params.productId))
  if ('error' in result) {
    res.status(404).json({ error: result.error })
    return
  }
  res.status(204).end()
})
