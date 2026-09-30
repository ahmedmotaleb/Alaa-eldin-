import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { api, type ApiAddress } from '../utils/api'

// مصدر واحد مشترك لعناوين العميل المحفوظة — بيستخدمه هيدر الرئيسية (العنوان المختصر) وشيت
// اختيار العنوان معاً، عشان أي تغيير (إضافة/تعديل/حذف/تغيير الافتراضي) يظهر فوراً في الاتنين
// من غير ما كل واجهة تعمل طلب API منفصل لنفس البيانات. صفحة "عناويني المحفوظة" (AddressesPage)
// بتستخدم نفس الـ context ده كمان بدل نسخة محلية منفصلة.
interface AddressContextValue {
  addresses: ApiAddress[]
  defaultAddress: ApiAddress | null
  loading: boolean
  refresh: () => void
  setDefault: (id: string) => Promise<void>
}

const AddressContext = createContext<AddressContextValue | null>(null)

export function AddressProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [addresses, setAddresses] = useState<ApiAddress[]>([])
  const [loading, setLoading] = useState(true)

  function refresh() {
    if (!user) {
      setAddresses([])
      setLoading(false)
      return
    }
    setLoading(true)
    api.listAddresses()
      .then(({ addresses: list }) => setAddresses(list))
      .catch(() => setAddresses([]))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [user])

  async function setDefault(id: string) {
    await api.setDefaultAddress(id)
    refresh()
  }

  const defaultAddress = addresses.find(a => a.isDefault) ?? null

  return (
    <AddressContext.Provider value={{ addresses, defaultAddress, loading, refresh, setDefault }}>
      {children}
    </AddressContext.Provider>
  )
}

export function useAddresses() {
  const value = useContext(AddressContext)
  if (!value) throw new Error('AddressProvider is missing')
  return value
}
