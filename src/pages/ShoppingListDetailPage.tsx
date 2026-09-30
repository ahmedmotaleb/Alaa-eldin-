import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { useCart } from '../store/CartContext'
import { EmptyState } from '../components/EmptyState'
import { api, ApiError, type ApiProduct, type ShoppingListItem } from '../utils/api'
import { formatMoney } from '../utils/money'
import { ar } from '../i18n/ar'

export function ShoppingListDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user, loading: authLoading } = useRequireAuth()
  const { addItem } = useCart()
  const navigate = useNavigate()

  const [listName, setListName] = useState('')
  const [items, setItems] = useState<ShoppingListItem[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ApiProduct[]>([])
  const [addingId, setAddingId] = useState('')

  function load() {
    if (!id) return
    api.getShoppingListItems(id)
      .then(({ list, items }) => { setListName(list.name); setItems(items) })
      .catch(err => setError(err instanceof ApiError && err.code === 'not_found' ? 'القائمة غير موجودة' : ar.errors.generic))
  }

  useEffect(() => {
    if (user) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id])

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return }
    const timeout = setTimeout(() => {
      api.autocomplete(search.trim()).then(({ products }) => setSearchResults(products)).catch(() => {})
    }, 250)
    return () => clearTimeout(timeout)
  }, [search])

  async function addProduct(productId: string) {
    if (!id) return
    setAddingId(productId)
    try {
      await api.setShoppingListItem(id, productId, 1)
      setSearch('')
      setSearchResults([])
      load()
    } catch {
      setError(ar.errors.generic)
    } finally {
      setAddingId('')
    }
  }

  async function updateQuantity(productId: string, quantity: number) {
    if (!id || quantity <= 0) return
    setItems(current => current?.map(i => i.productId === productId ? { ...i, quantity } : i) ?? null)
    try {
      await api.setShoppingListItem(id, productId, quantity)
    } catch {
      load()
    }
  }

  async function removeItem(productId: string) {
    if (!id) return
    setItems(current => current?.filter(i => i.productId !== productId) ?? null)
    try {
      await api.removeShoppingListItem(id, productId)
    } catch {
      load()
    }
  }

  async function rename() {
    if (!id) return
    const next = window.prompt(ar.shoppingLists.renamePrompt, listName)
    if (!next || !next.trim()) return
    try {
      await api.renameShoppingList(id, next.trim())
      setListName(next.trim())
    } catch {
      setError(ar.errors.generic)
    }
  }

  async function remove() {
    if (!id) return
    if (!window.confirm(ar.shoppingLists.deleteConfirm)) return
    try {
      await api.deleteShoppingList(id)
      navigate('/account/shopping-lists', { replace: true })
    } catch {
      setError(ar.errors.generic)
    }
  }

  function addAllToCart() {
    if (!items) return
    const available = items.filter(i => i.product?.available)
    const unavailableCount = items.length - available.length
    if (available.length === 0) {
      setNotice(ar.shoppingLists.addAllNoneAvailable)
      return
    }
    for (const item of available) addItem(item.productId, item.quantity)
    setNotice(unavailableCount > 0
      ? ar.shoppingLists.addAllPartial(available.length, unavailableCount)
      : ar.shoppingLists.addAllDone)
  }

  if (!user && !authLoading) return null
  if (error) return <div className="empty-card">{error}</div>
  if (!items) return null

  return (
    <div className="form-card">
      <Link to="/account/shopping-lists" style={{ display: 'inline-block', marginBottom: 12, color: '#12813C' }}>
        ← {ar.shoppingLists.back}
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{listName}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="secondary-button" onClick={rename}>✏️</button>
          <button className="secondary-button" onClick={remove}>🗑️</button>
        </div>
      </div>

      <div style={{ position: 'relative', marginBottom: 16 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={ar.shoppingLists.searchPlaceholder}
          style={{ width: '100%' }}
        />
        {searchResults.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', insetInlineStart: 0, insetInlineEnd: 0, zIndex: 10,
            background: '#fff', border: '1px solid #e5e9e6', borderRadius: 10, marginTop: 4,
            maxHeight: 260, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
          }}>
            {searchResults.map(p => (
              <button
                key={p.id}
                onClick={() => addProduct(p.id)}
                disabled={addingId === p.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', width: '100%', padding: '10px 12px',
                  border: 'none', background: 'none', textAlign: 'start', cursor: 'pointer', fontSize: 14
                }}
              >
                <span>{p.emoji} {p.name}</span>
                <span style={{ color: '#68746B' }}>{formatMoney(p.price)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {notice && <div className="admin-form-success" style={{ marginBottom: 12 }}>{notice}</div>}

      {items.length === 0 ? (
        <EmptyState icon="📝" title={ar.shoppingLists.emptyNote} />
      ) : (
        <>
          <div className="shopping-list-items">
            {items.map(item => (
              <div key={item.productId} className="shopping-list-item-row">
                <span className="shopping-list-item-info">
                  <strong>{item.product ? `${item.product.emoji} ${item.product.name}` : item.productId}</strong>
                  {item.product && !item.product.available && (
                    <span className="shopping-list-item-unavailable">{ar.shoppingLists.unavailableNote}</span>
                  )}
                </span>
                <input
                  className="shopping-list-item-qty"
                  type="number" min={1} value={item.quantity}
                  onChange={e => updateQuantity(item.productId, Number(e.target.value))}
                />
                <button className="secondary-button" onClick={() => removeItem(item.productId)}>{ar.shoppingLists.removeItem}</button>
              </div>
            ))}
          </div>
          <button className="shopping-list-add-all-button" onClick={addAllToCart}>{ar.shoppingLists.addAllToCart}</button>
        </>
      )}
    </div>
  )
}
