import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { api, ApiError, type ShoppingList } from '../utils/api'
import { ar } from '../i18n/ar'

export function ShoppingListsPage() {
  const { user, loading: authLoading } = useRequireAuth()
  const [lists, setLists] = useState<ShoppingList[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  function load() {
    api.listShoppingLists()
      .then(({ lists }) => setLists(lists))
      .catch(err => setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic))
  }

  useEffect(() => {
    if (user) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function create() {
    if (!name.trim()) return
    setCreating(true)
    try {
      await api.createShoppingList(name.trim())
      setName('')
      load()
    } catch {
      setError(ar.errors.generic)
    } finally {
      setCreating(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm(ar.shoppingLists.deleteConfirm)) return
    setLists(current => current?.filter(l => l.id !== id) ?? null)
    try {
      await api.deleteShoppingList(id)
    } catch {
      load()
    }
  }

  if (!user && !authLoading) return null
  if (error) return <div className="empty-card">{error}</div>
  if (!lists) return null

  return (
    <div className="form-card">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={ar.shoppingLists.newListPlaceholder}
          maxLength={60}
          style={{ flex: 1 }}
        />
        <button className="primary-button" disabled={creating || !name.trim()} onClick={create}>
          {ar.shoppingLists.createButton}
        </button>
      </div>

      {lists.length === 0 ? (
        <div className="empty-card">
          <div className="empty-icon">📝</div>
          <h2>{ar.shoppingLists.emptyTitle}</h2>
          <p>{ar.shoppingLists.emptyNote}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lists.map(list => (
            <div
              key={list.id}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: '#F7F8F7', borderRadius: 12, padding: '12px 14px'
              }}
            >
              <Link to={`/account/shopping-lists/${list.id}`} style={{ flex: 1, color: 'inherit', textDecoration: 'none' }}>
                <strong style={{ display: 'block' }}>{list.name}</strong>
                <span style={{ fontSize: 13, color: '#68746B' }}>{ar.shoppingLists.itemsCount(list.itemCount)}</span>
              </Link>
              <button className="secondary-button" onClick={() => remove(list.id)}>{ar.shoppingLists.removeItem}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
