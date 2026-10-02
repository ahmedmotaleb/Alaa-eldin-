import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type ApiSettings } from '../utils/api'
import { getSettings, setSettings, setCaptchaSiteKey } from './settingsStore'
import type { Category, DeliveryZone, DeliverySlot } from '../types/models'
import { ar } from '../i18n/ar'

// الكتالوج هنا بيحمّل بس الأقسام وإعدادات المتجر ومناطق/مواعيد التوصيل وقت بدء التشغيل —
// بيانات مرجعية نادراً ما تتغيّر، زي الأقسام بالظبط. مفيش تحميل لكل المنتجات خالص — أي صفحة
// محتاجة منتجات (الرئيسية، قسم، بحث، تفاصيل منتج...) بتجيبها بنفسها من GET /api/products
// (بصفحات/فلاتر) أو GET /api/products/:slug، كل واحدة على حدة.
//
// settings استثناء من مبدأ "نادراً ما تتغيّر": دي إعدادات تشغيلية (زي آخر ميعاد توصيل نفس
// اليوم) ممكن الأدمن يغيّرها في أي وقت، فلازم تكون state تفاعلية فعلية (مش متغيّر عادي خارج
// React زي settingsStore القديم) عشان أي مكوّن مشترك فيها يعيد الرندر تلقائياً لما تتغيّر —
// وبتتحدّث كمان لما الـ PWA ترجع للمقدمة (راجع useEffect تحت).
interface CatalogContextValue {
  categories: Category[]
  deliveryZones: DeliveryZone[]
  deliverySlots: DeliverySlot[]
  settings: ApiSettings
  loading: boolean
  error: string
}

const CatalogContext = createContext<CatalogContextValue | null>(null)

// حد أدنى بين تحديثين متتاليين للإعدادات بسبب رجوع التطبيق للمقدمة — لو المستخدم بدّل تبويبات
// بسرعة أو visibilitychange وfocus اتطلقوا مع بعض لنفس اللحظة، ما بنعملش أكتر من طلب واحد كل
// فترة قصيرة.
const FOREGROUND_REFRESH_THROTTLE_MS = 5000

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([])
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([])
  const [deliverySlots, setDeliverySlots] = useState<DeliverySlot[]>([])
  const [settingsState, setSettingsState] = useState<ApiSettings>(getSettings())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const lastRefreshAt = useRef(0)
  const refreshInFlight = useRef(false)

  useEffect(() => {
    Promise.all([api.listCategories(), api.getSettings(), api.listDeliveryZones(), api.listDeliverySlots()])
      .then(([catRes, settingsRes, zonesRes, slotsRes]) => {
        setCategories(catRes.categories)
        setSettings(settingsRes.settings)
        setSettingsState(settingsRes.settings)
        setCaptchaSiteKey(settingsRes.captcha.turnstileSiteKey)
        setDeliveryZones(zonesRes.zones)
        setDeliverySlots(slotsRes.slots)
        lastRefreshAt.current = Date.now()
      })
      .catch(() => setError(ar.errors.forCode('network_error')))
      .finally(() => setLoading(false))
  }, [])

  // لما الـ PWA المثبّتة (أو أي تبويب) ترجع للمقدمة بعد ما كانت في الخلفية — إعدادات المتجر
  // بس هي اللي بتتحدّث (مش الأقسام ولا مناطق/مواعيد التوصيل، نادراً ما تتغيّر وتحميلها تاني
  // على كل رجوع للمقدمة إهدار غير مبرر). dedupe عن طريق refreshInFlight (مفيش طلبين في نفس
  // الوقت) وthrottle عن طريق lastRefreshAt (مفيش طلب جديد قبل ما تعدي فترة الـ throttle).
  useEffect(() => {
    function refreshSettings() {
      if (refreshInFlight.current) return
      if (Date.now() - lastRefreshAt.current < FOREGROUND_REFRESH_THROTTLE_MS) return
      refreshInFlight.current = true
      api.getSettings()
        .then(({ settings, captcha }) => {
          setSettings(settings)
          setSettingsState(settings)
          setCaptchaSiteKey(captcha.turnstileSiteKey)
          lastRefreshAt.current = Date.now()
        })
        .catch(() => {})
        .finally(() => { refreshInFlight.current = false })
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') refreshSettings()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refreshSettings)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refreshSettings)
    }
  }, [])

  return (
    <CatalogContext.Provider value={{ categories, deliveryZones, deliverySlots, settings: settingsState, loading, error }}>
      {children}
    </CatalogContext.Provider>
  )
}

export function useCatalog() {
  const value = useContext(CatalogContext)
  if (!value) throw new Error('CatalogProvider is missing')
  return value
}
