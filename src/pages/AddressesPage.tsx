import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { useCatalog } from '../store/CatalogContext'
import { api, ApiError, type ApiAddress, type ApiAddressInput } from '../utils/api'
import { ar } from '../i18n/ar'

const emptyForm: ApiAddressInput = {
  label: '', fullName: '', mobile: '', governorate: '', area: '', address: '',
  building: '', floor: '', apartment: '', landmark: '', isDefault: false
}

export function AddressesPage() {
  const { user, loading: authLoading } = useRequireAuth()
  const { deliveryZones } = useCatalog()
  const navigate = useNavigate()
  const [addresses, setAddresses] = useState<ApiAddress[] | null>(null)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ApiAddressInput>(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  function load() {
    api.listAddresses()
      .then(({ addresses: list }) => setAddresses(list))
      .catch(err => setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic))
  }

  useEffect(() => {
    if (user) load()
  }, [user])

  if (!user && !authLoading) return null

  function startAdd() {
    setForm(emptyForm)
    setEditingId(null)
    setFormError('')
    setShowForm(true)
  }

  function startEdit(address: ApiAddress) {
    setForm({
      label: address.label, fullName: address.fullName ?? '', mobile: address.mobile ?? '',
      governorate: address.governorate, area: address.area, address: address.address,
      building: address.building, floor: address.floor, apartment: address.apartment,
      landmark: address.landmark, isDefault: address.isDefault
    })
    setEditingId(address.id)
    setFormError('')
    setShowForm(true)
  }

  function set<K extends keyof ApiAddressInput>(key: K, value: ApiAddressInput[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function save() {
    setFormError('')
    if (!form.governorate.trim()) {
      setFormError(ar.addresses.governorateRequired)
      return
    }
    if (!form.address.trim()) {
      setFormError(ar.addresses.addressRequired)
      return
    }
    setSaving(true)
    try {
      if (editingId) await api.updateAddress(editingId, form)
      else await api.createAddress(form)
      setShowForm(false)
      load()
    } catch {
      setFormError(ar.errors.generic)
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm(ar.addresses.deleteConfirm)) return
    await api.deleteAddress(id)
    load()
  }

  async function makeDefault(id: string) {
    await api.setDefaultAddress(id)
    load()
  }

  if (error) return <div className="empty-card">{error}</div>
  if (!addresses) return null

  return (
    <div className="addresses-page">
      {!showForm && (
        <>
          {addresses.length === 0 ? (
            <div className="empty-card">
              <div className="empty-icon">📍</div>
              <h2>{ar.addresses.emptyTitle}</h2>
              <p>{ar.addresses.emptyNote}</p>
            </div>
          ) : (
            <div className="address-list">
              {addresses.map(a => (
                <div className="address-card" key={a.id}>
                  <div className="address-card-head">
                    <strong>{a.label || a.governorate}</strong>
                    {a.isDefault && <span className="address-default-badge">{ar.addresses.defaultBadge}</span>}
                  </div>
                  <div className="address-card-body">{a.area ? `${a.area}، ` : ''}{a.address}</div>
                  <div className="address-card-actions">
                    {!a.isDefault && <button onClick={() => makeDefault(a.id)}>{ar.addresses.setDefault}</button>}
                    <button onClick={() => startEdit(a)}>{ar.addresses.edit}</button>
                    <button className="danger" onClick={() => remove(a.id)}>{ar.addresses.delete}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="primary-button" onClick={startAdd}>{ar.addresses.addNew}</button>
        </>
      )}

      {showForm && (
        <div className="form-card">
          <label>{ar.addresses.labelField}
            <input value={form.label} onChange={e => set('label', e.target.value)} placeholder={ar.addresses.labelPlaceholder} />
          </label>
          <label>{ar.addresses.fullNameField}
            <input value={form.fullName} onChange={e => set('fullName', e.target.value)} />
          </label>
          <label>{ar.addresses.mobileField}
            <input value={form.mobile} onChange={e => set('mobile', e.target.value)} inputMode="numeric" autoComplete="tel" />
          </label>
          <label>{ar.addresses.governorateField}
            <select value={form.governorate} onChange={e => set('governorate', e.target.value)}>
              <option value="" disabled>{ar.checkout.governoratePlaceholder}</option>
              {deliveryZones.map(z => <option key={z.governorate} value={z.governorate}>{z.governorate}</option>)}
            </select>
          </label>
          <label>{ar.addresses.areaField}
            <input value={form.area} onChange={e => set('area', e.target.value)} />
          </label>
          <label>{ar.addresses.addressField}
            <input value={form.address} onChange={e => set('address', e.target.value)} />
          </label>
          <div className="admin-row-2">
            <label>{ar.addresses.buildingField}
              <input value={form.building} onChange={e => set('building', e.target.value)} />
            </label>
            <label>{ar.addresses.floorField}
              <input value={form.floor} onChange={e => set('floor', e.target.value)} />
            </label>
          </div>
          <div className="admin-row-2">
            <label>{ar.addresses.apartmentField}
              <input value={form.apartment} onChange={e => set('apartment', e.target.value)} />
            </label>
            <label>{ar.addresses.landmarkField}
              <input value={form.landmark} onChange={e => set('landmark', e.target.value)} />
            </label>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={form.isDefault} onChange={e => set('isDefault', e.target.checked)} />
            {ar.addresses.setDefault}
          </label>

          {formError && <div className="field-error">{formError}</div>}
          <div className="address-form-actions">
            <button className="secondary-button" onClick={() => setShowForm(false)}>{ar.addresses.cancel}</button>
            <button className="primary-button" disabled={saving} onClick={save}>{ar.addresses.save}</button>
          </div>
        </div>
      )}

      {!showForm && <button className="secondary-button" onClick={() => navigate('/account')} style={{ marginTop: 8 }}>{ar.common.back}</button>}
    </div>
  )
}
