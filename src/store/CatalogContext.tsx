import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../utils/api'
import { setSettings } from './settingsStore'
import type { Category, DeliveryZone, DeliverySlot } from '../types/models'
import { ar } from '../i18n/ar'

// الكتالوج هنا بيحمّل بس الأقسام وإعدادات المتجر ومناطق/مواعيد التوصيل وقت بدء التشغيل —
// بيانات مرجعية نادراً ما تتغيّر، زي الأقسام بالظبط. مفيش تحميل لكل المنتجات خالص — أي صفحة
// محتاجة منتجات (الرئيسية، قسم، بحث، تفاصيل منتج...) بتجيبها بنفسها من GET /api/products
// (بصفحات/فلاتر) أو GET /api/products/:slug، كل واحدة على حدة.
interface CatalogContextValue {
  categories: Category[]
  deliveryZones: DeliveryZone[]
  deliverySlots: DeliverySlot[]
  loading: boolean
  error: string
}

const CatalogContext = createContext<CatalogContextValue | null>(null)

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([])
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([])
  const [deliverySlots, setDeliverySlots] = useState<DeliverySlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.listCategories(), api.getSettings(), api.listDeliveryZones(), api.listDeliverySlots()])
      .then(([catRes, settingsRes, zonesRes, slotsRes]) => {
        setCategories(catRes.categories)
        setSettings(settingsRes.settings)
        setDeliveryZones(zonesRes.zones)
        setDeliverySlots(slotsRes.slots)
      })
      .catch(() => setError(ar.errors.forCode('network_error')))
      .finally(() => setLoading(false))
  }, [])

  return (
    <CatalogContext.Provider value={{ categories, deliveryZones, deliverySlots, loading, error }}>
      {children}
    </CatalogContext.Provider>
  )
}

export function useCatalog() {
  const value = useContext(CatalogContext)
  if (!value) throw new Error('CatalogProvider is missing')
  return value
}
