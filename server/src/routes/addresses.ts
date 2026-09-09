import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { listAddresses, createAddress, updateAddress, deleteAddress, setDefaultAddress, type AddressInput } from '../services/addressService.js'
import { logEvent } from '../logger.js'

export const addressesRouter = Router()
addressesRouter.use(requireAuth)

// كل الحقول اختيارية غير المحافظة والعنوان نفسه — مفيش أي إجبار لملء الاسم/الموبايل/المنطقة
// أو أي تفاصيل إضافية (عمارة/دور/شقة/علامة مميزة).
function validateBody(body: unknown): AddressInput | null {
  const b = body as Record<string, unknown>
  if (
    typeof b?.governorate !== 'string' || !b.governorate.trim() ||
    typeof b?.address !== 'string' || !b.address.trim()
  ) return null

  return {
    label: typeof b.label === 'string' ? b.label.trim() : '',
    fullName: typeof b.fullName === 'string' && b.fullName.trim() ? b.fullName.trim() : undefined,
    mobile: typeof b.mobile === 'string' && b.mobile.trim() ? b.mobile.trim() : undefined,
    governorate: b.governorate.trim(),
    area: typeof b.area === 'string' ? b.area.trim() : '',
    address: b.address.trim(),
    building: typeof b.building === 'string' ? b.building.trim() : '',
    floor: typeof b.floor === 'string' ? b.floor.trim() : '',
    apartment: typeof b.apartment === 'string' ? b.apartment.trim() : '',
    landmark: typeof b.landmark === 'string' ? b.landmark.trim() : '',
    isDefault: b.isDefault === true
  }
}

addressesRouter.get('/', async (req, res) => {
  const addresses = await listAddresses(req.user!.id)
  res.json({ addresses })
})

addressesRouter.post('/', async (req, res) => {
  const data = validateBody(req.body)
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }
  const address = await createAddress(req.user!.id, data)
  logEvent('address_created', { userId: req.user!.id, addressId: address.id })
  res.status(201).json({ address })
})

addressesRouter.put('/:id', async (req, res) => {
  const data = validateBody(req.body)
  if (!data) {
    res.status(400).json({ error: 'missing_fields' })
    return
  }
  const address = await updateAddress(req.user!.id, String(req.params.id), data)
  if (!address) {
    res.status(404).json({ error: 'address_not_found' })
    return
  }
  logEvent('address_updated', { userId: req.user!.id, addressId: address.id })
  res.json({ address })
})

addressesRouter.post('/:id/default', async (req, res) => {
  const address = await setDefaultAddress(req.user!.id, String(req.params.id))
  if (!address) {
    res.status(404).json({ error: 'address_not_found' })
    return
  }
  res.json({ address })
})

addressesRouter.delete('/:id', async (req, res) => {
  const ok = await deleteAddress(req.user!.id, String(req.params.id))
  if (!ok) {
    res.status(404).json({ error: 'address_not_found' })
    return
  }
  logEvent('address_deleted', { userId: req.user!.id, addressId: String(req.params.id) })
  res.status(204).end()
})
