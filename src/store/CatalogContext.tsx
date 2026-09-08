import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../utils/api'
import { setSettings } from './settingsStore'
import type { Category, Product } from '../types/models'
import { ar } from '../i18n/ar'

interface CatalogContextValue {
  products: Product[]
  categories: Category[]
  loading: boolean
  error: string
}

const CatalogContext = createContext<CatalogContextValue | null>(null)

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.listCategories(), api.listProducts(), api.getSettings()])
      .then(([catRes, prodRes, settingsRes]) => {
        setCategories(catRes.categories)
        setProducts(prodRes.products)
        setSettings(settingsRes.settings)
      })
      .catch(() => setError(ar.errors.forCode('network_error')))
      .finally(() => setLoading(false))
  }, [])

  return (
    <CatalogContext.Provider value={{ products, categories, loading, error }}>
      {children}
    </CatalogContext.Provider>
  )
}

export function useCatalog() {
  const value = useContext(CatalogContext)
  if (!value) throw new Error('CatalogProvider is missing')
  return value
}
