import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { EmptyState } from '../components/EmptyState'
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
    <div className="shopping-lists-page">
      <div className="shopping-list-create-card">
        <input
          className="shopping-list-create-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={ar.shoppingLists.newListPlaceholder}
          maxLength={60}
        />
        <button className="primary-button" disabled={creating || !name.trim()} onClick={create}>
          {ar.shoppingLists.createButton}
        </button>
      </div>

      {lists.length === 0 ? (
        <EmptyState icon="📝" title={ar.shoppingLists.emptyTitle} note={ar.shoppingLists.emptyNote} />
      ) : (
        <div className="shopping-list-cards">
          {lists.map(list => (
            <div className="shopping-list-card" key={list.id}>
              <Link to={`/account/shopping-lists/${list.id}`} className="shopping-list-card-body">
                <strong className="shopping-list-card-name">{list.name}</strong>
                <span className="shopping-list-card-meta">{ar.shoppingLists.itemsCount(list.itemCount)}</span>
              </Link>
              <button className="secondary-button" onClick={() => remove(list.id)}>{ar.shoppingLists.removeItem}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
