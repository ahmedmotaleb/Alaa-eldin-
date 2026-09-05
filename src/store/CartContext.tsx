import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { products } from '../data/products'
import { STORE_CONFIG } from '../config/store'
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
  total: number
  addItem: (productId: string, quantity?: number) => void
  setQuantity: (productId: string, quantity: number) => void
  removeItem: (productId: string) => void
  clearCart: () => void
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
  const [items, setItems] = useState<CartItem[]>(loadInitialCart)

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
  }, [items])

  const subtotal = detailedItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const deliveryFee = subtotal >= STORE_CONFIG.freeShippingThreshold || subtotal === 0 ? 0 : STORE_CONFIG.deliveryFee
  const total = subtotal + deliveryFee
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)

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
  }

  return (
    <CartContext.Provider value={{
      items, detailedItems, totalQuantity, subtotal, deliveryFee, total,
      addItem, setQuantity, removeItem, clearCart
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
