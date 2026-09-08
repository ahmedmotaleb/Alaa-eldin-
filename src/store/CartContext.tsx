import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useCatalog } from './CatalogContext'
import { getSettings } from './settingsStore'
import { api, type ApiDiscount } from '../utils/api'
import type { CartItem, Product } from '../types/models'

interface DetailedCartItem extends CartItem {
  product: Product
}

interface CartContextValue {
  items: CartItem[]
  detailedItems: DetailedCartItem[]
  totalQuantity: number
  subtotal: number
  deliveryFee: number
  discount: ApiDiscount | null
  total: number
  addItem: (productId: string, quantity?: number) => void
  setQuantity: (productId: string, quantity: number) => void
  removeItem: (productId: string) => void
  clearCart: () => void
  applyDiscount: (code: string) => Promise<void>
  removeDiscount: () => void
}

const CartContext = createContext<CartContextValue | null>(null)
const STORAGE_KEY = 'alaa-eldin-cart'

function loadInitialCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { products } = useCatalog()
  const [items, setItems] = useState<CartItem[]>(loadInitialCart)
  const [discount, setDiscount] = useState<ApiDiscount | null>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }, [items])

  const detailedItems = useMemo(() => {
    return items
      .map(item => {
        const product = products.find(p => p.id === item.productId)
        return product ? { ...item, product } : null
      })
      .filter(Boolean) as DetailedCartItem[]
  }, [items, products])

  const subtotal = detailedItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const deliveryFee = subtotal >= getSettings().freeShippingThreshold || subtotal === 0 ? 0 : getSettings().deliveryFee
  const total = Math.max(0, subtotal - (discount?.amount ?? 0)) + deliveryFee
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)

  // إعادة التحقق من الخصم كلما تغير الإجمالي (تغيير كمية/حذف منتج) — قد يصبح الخصم غير صالح
  // (نسبة الخصم تتغير مع القيمة، أو الطلب لم يعد يحقق الحد الأدنى)، أو نلغيه بصمت لو صار غير صالح.
  useEffect(() => {
    if (!discount) return
    let cancelled = false
    api.validateDiscount(discount.code, subtotal)
      .then(({ discount: fresh }) => { if (!cancelled) setDiscount(fresh) })
      .catch(() => { if (!cancelled) setDiscount(null) })
    return () => { cancelled = true }
  }, [subtotal])

  async function applyDiscount(code: string) {
    const { discount: fresh } = await api.validateDiscount(code, subtotal)
    setDiscount(fresh)
  }

  function removeDiscount() {
    setDiscount(null)
  }

  function addItem(productId: string, quantity = 1) {
    setItems(current => {
      const existing = current.find(item => item.productId === productId)
      if (existing) {
        return current.map(item =>
          item.productId === productId ? { ...item, quantity: item.quantity + quantity } : item
        )
      }
      return [...current, { productId, quantity }]
    })
  }

  function setQuantity(productId: string, quantity: number) {
    if (quantity <= 0) {
      removeItem(productId)
      return
    }
    setItems(current => current.map(item => item.productId === productId ? { ...item, quantity } : item))
  }

  function removeItem(productId: string) {
    setItems(current => current.filter(item => item.productId !== productId))
  }

  function clearCart() {
    setItems([])
    setDiscount(null)
  }

  return (
    <CartContext.Provider value={{
      items, detailedItems, totalQuantity, subtotal, deliveryFee, discount, total,
      addItem, setQuantity, removeItem, clearCart, applyDiscount, removeDiscount
    }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const value = useContext(CartContext)
  if (!value) throw new Error('CartProvider is missing')
  return value
}
