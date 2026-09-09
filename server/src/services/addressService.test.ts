import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { listAddresses, getAddress, createAddress, updateAddress, deleteAddress, setDefaultAddress, type AddressInput } from './addressService.js'

const USER_ID = 'test-user-addr-1'
const OTHER_USER_ID = 'test-user-addr-2'

async function resetFixtures() {
  await pool.query('DELETE FROM customer_addresses')
  await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[USER_ID, OTHER_USER_ID]])
  for (const id of [USER_ID, OTHER_USER_ID]) {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $2, 'x', 'عميل اختبار', now())`,
      [id, `${id}@test.local`]
    )
  }
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

function baseInput(overrides: Partial<AddressInput> = {}): AddressInput {
  return {
    label: 'المنزل',
    governorate: 'القاهرة',
    address: 'شارع التحرير 10',
    isDefault: false,
    ...overrides
  }
}

describe('createAddress / listAddresses / getAddress', () => {
  it('creates an address with only governorate and address required', async () => {
    const address = await createAddress(USER_ID, baseInput())
    expect(address.governorate).toBe('القاهرة')
    expect(address.address).toBe('شارع التحرير 10')
    expect(address.fullName).toBeUndefined()
    expect(address.mobile).toBeUndefined()
  })

  it('lists only the requesting user\'s own addresses', async () => {
    await createAddress(USER_ID, baseInput({ label: 'بيتي' }))
    await createAddress(OTHER_USER_ID, baseInput({ label: 'عنوان الآخر' }))
    const mine = await listAddresses(USER_ID)
    expect(mine.map(a => a.label)).toEqual(['بيتي'])
  })

  it('getAddress returns null for another user\'s address (no cross-account leak)', async () => {
    const address = await createAddress(OTHER_USER_ID, baseInput())
    expect(await getAddress(USER_ID, address.id)).toBeNull()
  })
})

describe('default address handling', () => {
  it('setting a new address as default unsets the previous default', async () => {
    const first = await createAddress(USER_ID, baseInput({ label: 'الأول', isDefault: true }))
    const second = await createAddress(USER_ID, baseInput({ label: 'الثاني', isDefault: true }))

    const list = await listAddresses(USER_ID)
    const firstAfter = list.find(a => a.id === first.id)!
    const secondAfter = list.find(a => a.id === second.id)!
    expect(firstAfter.isDefault).toBe(false)
    expect(secondAfter.isDefault).toBe(true)
  })

  it('setDefaultAddress moves the default flag to the chosen address', async () => {
    const first = await createAddress(USER_ID, baseInput({ label: 'الأول', isDefault: true }))
    const second = await createAddress(USER_ID, baseInput({ label: 'الثاني' }))

    await setDefaultAddress(USER_ID, second.id)
    const list = await listAddresses(USER_ID)
    expect(list.find(a => a.id === first.id)!.isDefault).toBe(false)
    expect(list.find(a => a.id === second.id)!.isDefault).toBe(true)
  })

  it('never allows two default addresses for the same user at once', async () => {
    await createAddress(USER_ID, baseInput({ isDefault: true }))
    await createAddress(USER_ID, baseInput({ isDefault: true }))
    await createAddress(USER_ID, baseInput({ isDefault: true }))
    const { rows } = await pool.query('SELECT count(*) as n FROM customer_addresses WHERE user_id = $1 AND is_default = 1', [USER_ID])
    expect(Number(rows[0].n)).toBe(1)
  })
})

describe('updateAddress / deleteAddress', () => {
  it('updates an existing address', async () => {
    const address = await createAddress(USER_ID, baseInput())
    const updated = await updateAddress(USER_ID, address.id, baseInput({ label: 'محدّث', area: 'مدينة نصر' }))
    expect(updated?.label).toBe('محدّث')
    expect(updated?.area).toBe('مدينة نصر')
  })

  it('returns null when updating an address that belongs to another user', async () => {
    const address = await createAddress(OTHER_USER_ID, baseInput())
    expect(await updateAddress(USER_ID, address.id, baseInput())).toBeNull()
  })

  it('deletes an address and confirms it is gone', async () => {
    const address = await createAddress(USER_ID, baseInput())
    expect(await deleteAddress(USER_ID, address.id)).toBe(true)
    expect(await getAddress(USER_ID, address.id)).toBeNull()
  })

  it('does not delete another user\'s address', async () => {
    const address = await createAddress(OTHER_USER_ID, baseInput())
    expect(await deleteAddress(USER_ID, address.id)).toBe(false)
    expect(await getAddress(OTHER_USER_ID, address.id)).not.toBeNull()
  })
})
