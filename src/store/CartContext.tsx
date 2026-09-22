import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSettings } from './settingsStore'
import { useAuth } from './AuthContext'
import { api, type ApiDiscount, type ApiProductVariant, type ApiPromotionApplication } from '../utils/api'
import type { CartItem, Product } from '../types/models'

interface DetailedCartItem extends CartItem {
  product: Product
  // موجودة بس لو العنصر مرتبط بمتغير فعلي لسه متاح — سعرها/مخزونها بيتغلّبوا على المنتج
  // الأساسي عند الحساب. متغير اتحذف أو بقى غير متاح بيتعامل زي "المنتج نفسه مش متاح".
  variant?: ApiProductVariant
  // اسم/سعر العرض الفعليين للصنف — بيراعوا المتغير المختار لو موجود، بدل ما كل مكان
  // يعرض السلة يعيد نفس منطق "المتغير ولا المنتج الأساسي" بنفسه.
  displayName: string
  unitPrice: number
  // العنصر لسه معروض في السلة (يقدر العميل يشوفه/يعدّل كميته/يشيله)، لكنه ما بيتحسبش في
  // الإجمالي ولا ينفع يتم الدفع بيه لحد ما يتحل — إما المنتج بقى غير متوفر خالص، أو
  // الكمية المطلوبة بقت أكتر من المتاح المعروض (لو الإعداد ده مفعّل من الإدارة).
  blockingIssue: 'unavailable' | 'insufficient_stock' | null
}

interface CartContextValue {
  items: CartItem[]
  detailedItems: DetailedCartItem[]
  hasBlockingIssues: boolean
  totalQuantity: number
  subtotal: number
  deliveryFee: number
  discount: ApiDiscount | null
  promotions: ApiPromotionApplication[]
  promotionsDiscount: number
  total: number
  addItem: (productId: string, quantity?: number, variantId?: string) => void
  setQuantity: (productId: string, quantity: number, variantId?: string) => void
  removeItem: (productId: string, variantId?: string) => void
  clearCart: () => void
  applyDiscount: (code: string) => Promise<void>
  removeDiscount: () => void
}

// نفس الصنف والمنتج بالظبط — بما فيه نفس المتغير تحديداً (أو من غير متغير خالص للاتنين).
// متغيرين مختلفين لنفس المنتج، أو منتج بمتغير مقابل نفس المنتج من غيره، صفوف منفصلة تماماً.
function sameLine(item: CartItem, productId: string, variantId?: string): boolean {
  return item.productId === productId && item.variantId === variantId
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
  const { user } = useAuth()
  const [items, setItems] = useState<CartItem[]>(loadInitialCart)
  const [resolved, setResolved] = useState<Record<string, Product>>({})
  const [resolvedVariants, setResolvedVariants] = useState<Record<string, ApiProductVariant>>({})
  const [discount, setDiscount] = useState<ApiDiscount | null>(null)
  const [promotions, setPromotions] = useState<ApiPromotionApplication[]>([])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }, [items])

  // مرآة بسيطة للسلة على السيرفر — للعميل المسجّل دخول بس (الزائر مفيش أي وسيلة نوصله
  // بيها لاحقاً أصلاً)، بغرض تذكير السلة المهجورة فقط، مش أي قرار سعر/مخزون. مؤجّلة (debounce)
  // عشان ما نبعتش طلب مع كل تغيير كمية فوري.
  useEffect(() => {
    if (!user) return
    const timeout = setTimeout(() => {
      if (items.length === 0) {
        api.clearCartSnapshot().catch(() => {})
        return
      }
      api.syncCartSnapshot(items.map(i => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity }))).catch(() => {})
    }, 2000)
    return () => clearTimeout(timeout)
  }, [items, user])

  // السلة بتاخد بيانات المنتجات الحالية (سعر/صورة/توفر/وحدة) من نقطة الحل الجماعي
  // POST /api/products/resolve بدل ما تحمّل الكتالوج كامل — بيتعاد الطلب لما تتغير مجموعة
  // معرفات المنتجات الموجودة في السلة فقط.
  const idsKey = [...new Set(items.map(item => item.productId))].sort().join(',')
  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : []
    if (!ids.length) {
      setResolved({})
      return
    }
    let cancelled = false
    api.resolveProducts(ids)
      .then(({ products }) => {
        if (cancelled) return
        setResolved(Object.fromEntries(products.map(p => [p.id, p])))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [idsKey])

  // نفس المبدأ بالظبط لمتغيرات المنتج المختارة في السلة — سعر/مخزون/توفر المتغير هو
  // المصدر الحقيقي للصنف ده، مش المنتج الأساسي، لحد ما السيرفر يتحقق منه فعلياً وقت الدفع.
  const variantIdsKey = [...new Set(items.map(item => item.variantId).filter((id): id is string => !!id))].sort().join(',')
  useEffect(() => {
    const ids = variantIdsKey ? variantIdsKey.split(',') : []
    if (!ids.length) {
      setResolvedVariants({})
      return
    }
    let cancelled = false
    api.resolveVariants(ids)
      .then(({ variants }) => {
        if (cancelled) return
        setResolvedVariants(Object.fromEntries(variants.map(v => [v.id, v])))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [variantIdsKey])

  const detailedItems = useMemo(() => {
    return items
      .map(item => {
        const product = resolved[item.productId]
        if (!product) return null
        // العنصر مرتبط بمتغير: لو المتغير مش موجود في نتيجة الحل (اتحذف أو بقى غير متاح)،
        // الصنف يتعامل زي منتج "غير متوفر" تماماً — مش رجوع صامت لسعر/مخزون المنتج الأساسي.
        if (item.variantId) {
          const variant = resolvedVariants[item.variantId]
          if (!variant) return { ...item, product, displayName: product.name, unitPrice: product.price, blockingIssue: 'unavailable' as const }
          const blockingIssue: DetailedCartItem['blockingIssue'] = item.quantity > variant.stock ? 'insufficient_stock' : null
          return { ...item, product, variant, displayName: `${product.name} - ${variant.name}`, unitPrice: variant.price, blockingIssue }
        }
        const blockingIssue: DetailedCartItem['blockingIssue'] = !product.available
          ? 'unavailable'
          : (typeof product.lowStockRemaining === 'number' && item.quantity > product.lowStockRemaining)
            ? 'insufficient_stock'
            : null
        return { ...item, product, displayName: product.name, unitPrice: product.price, blockingIssue }
      })
      .filter(Boolean) as DetailedCartItem[]
  }, [items, resolved, resolvedVariants])

  const hasBlockingIssues = detailedItems.some(item => item.blockingIssue !== null)
  // بنود فيها مشكلة (غير متوفر، أو الكمية أكتر من المتاح) ما بتتحسبش في الإجمالي —
  // ما ينفعش نعرض إجمالي بيتضمن حاجة مش هتتشحن فعلياً.
  const subtotal = detailedItems.reduce((sum, item) => sum + (item.blockingIssue ? 0 : item.unitPrice * item.quantity), 0)
  // بتتبعت لمعاينة الخصم عشان خصم مقيّد بفئة/منتج معيّن يتحسب بدقة (مش افتراض إن السلة
  // كلها مؤهّلة) — نفس شكل البيانات اللي orderService.createOrder هيتحقق منه فعلياً وقت الدفع.
  const discountCartItems = useMemo(
    () => detailedItems.filter(item => !item.blockingIssue).map(item => ({
      productId: item.product.id, categoryId: item.product.categoryId, quantity: item.quantity, unitPrice: item.unitPrice
    })),
    [detailedItems]
  )
  const promotionsDiscount = promotions.reduce((sum, p) => sum + p.discountAmount, 0)
  const deliveryFee = discount?.freeDelivery
    ? 0
    : (subtotal >= getSettings().freeShippingThreshold || subtotal === 0 ? 0 : getSettings().deliveryFee)
  const total = Math.max(0, subtotal - (discount?.amount ?? 0) - promotionsDiscount) + deliveryFee
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)

  // عروض BOGO/الباقات التلقائية — بتتفعّل من محتوى السلة نفسه من غير أي كود، فمحتاجة تتحسب
  // دايماً (مش بس لما فيه كود خصم مطبّق زي useEffect الخصم اللي فوق)، وتُعاد كل ما يتغيّر
  // محتوى السلة الفعلي المؤهّل. المبلغ النهائي الحقيقي دايماً بيتأكد من جديد جوه
  // orderService.createOrder وقت الدفع — المعاينة هنا بس لعرض الخصم المتوقع للعميل.
  useEffect(() => {
    if (discountCartItems.length === 0) { setPromotions([]); return }
    let cancelled = false
    api.previewPromotions(discountCartItems)
      .then(({ promotions: fresh }) => { if (!cancelled) setPromotions(fresh) })
      .catch(() => { if (!cancelled) setPromotions([]) })
    return () => { cancelled = true }
  }, [discountCartItems])

  // إعادة التحقق من الخصم كلما تغير الإجمالي (تغيير كمية/حذف منتج) — قد يصبح الخصم غير صالح
  // (نسبة الخصم تتغير مع القيمة، أو الطلب لم يعد يحقق الحد الأدنى)، أو نلغيه بصمت لو صار غير صالح.
  useEffect(() => {
    if (!discount) return
    let cancelled = false
    api.validateDiscount(discount.code, subtotal, discountCartItems)
      .then(({ discount: fresh }) => { if (!cancelled) setDiscount(fresh) })
      .catch(() => { if (!cancelled) setDiscount(null) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal])

  async function applyDiscount(code: string) {
    const { discount: fresh } = await api.validateDiscount(code, subtotal, discountCartItems)
    setDiscount(fresh)
  }

  function removeDiscount() {
    setDiscount(null)
  }

  function addItem(productId: string, quantity = 1, variantId?: string) {
    setItems(current => {
      const existing = current.find(item => sameLine(item, productId, variantId))
      if (existing) {
        return current.map(item =>
          sameLine(item, productId, variantId) ? { ...item, quantity: item.quantity + quantity } : item
        )
      }
      return [...current, { productId, variantId, quantity }]
    })
  }

  function setQuantity(productId: string, quantity: number, variantId?: string) {
    if (quantity <= 0) {
      removeItem(productId, variantId)
      return
    }
    setItems(current => current.map(item => sameLine(item, productId, variantId) ? { ...item, quantity } : item))
  }

  function removeItem(productId: string, variantId?: string) {
    setItems(current => current.filter(item => !sameLine(item, productId, variantId)))
  }

  function clearCart() {
    setItems([])
    setDiscount(null)
    setPromotions([])
  }

  return (
    <CartContext.Provider value={{
      items, detailedItems, hasBlockingIssues, totalQuantity, subtotal, deliveryFee, discount, promotions, promotionsDiscount, total,
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
