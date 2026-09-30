import { useEffect, useRef, useState } from 'react'
import type { Product } from '../types/models'
import { api, type ApiProductVariant } from '../utils/api'
import { useCart } from '../store/CartContext'
import { useToast } from '../store/ToastContext'
import { ProductArt } from './ProductArt'
import { formatMoney } from '../utils/money'
import { ar } from '../i18n/ar'

// شيت اختيار الوزن/الوحدة — بيفتح من كارت المنتج مباشرة للمنتجات اللي عندها متغيرات (وزن/وحدة
// متعددة)، بدل ما يضطر العميل يروح لصفحة تفاصيل المنتج بس عشان يختار. بيستخدم نفس نظام
// السلة والمتغيرات الموجود بالفعل (useCart().setQuantity لكل متغير على حدة) — مفيش أي
// سعر أو مخزون بيتحسب أو يتخزن هنا بشكل مستقل، الإجمالي المعروض معاينة محلية بس.
export function WeightBottomSheet({ product, onClose }: { product: Product, onClose: () => void }) {
  const { items, setQuantity } = useCart()
  const flash = useToast()
  const [variants, setVariants] = useState<ApiProductVariant[] | null>(null)
  const [selections, setSelections] = useState<Record<string, number>>({})
  const sheetRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<Element | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getProductVariantsForSelection(product.id)
      .then(({ variants: fresh }) => {
        if (cancelled) return
        setVariants(fresh)
        setSelections(Object.fromEntries(
          fresh.map(v => [v.id, items.find(i => i.productId === product.id && i.variantId === v.id)?.quantity ?? 0])
        ))
      })
      .catch(() => { if (!cancelled) setVariants([]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id])

  useEffect(() => {
    previouslyFocused.current = document.activeElement
    sheetRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus()
    }
  }, [onClose])

  function setVariantQuantity(variant: ApiProductVariant, quantity: number) {
    const clamped = Math.max(0, Math.min(quantity, variant.stock))
    setSelections(current => ({ ...current, [variant.id]: clamped }))
  }

  const selectedTotal = (variants ?? []).reduce((sum, v) => sum + (selections[v.id] ?? 0) * v.price, 0)
  const hasSelection = Object.values(selections).some(q => q > 0)

  function confirm() {
    for (const variant of variants ?? []) {
      setQuantity(product.id, selections[variant.id] ?? 0, variant.id)
    }
    flash(ar.common.addedToCart)
    onClose()
  }

  return (
    <div className="unit-sheet-backdrop" onClick={onClose}>
      <div
        className="unit-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={product.name}
        tabIndex={-1}
        ref={sheetRef}
        onClick={e => e.stopPropagation()}
      >
        <div className="unit-sheet-handle" />
        <button type="button" className="unit-sheet-close" onClick={onClose} aria-label={ar.unitSheet.close}>✕</button>

        <div className="unit-sheet-header">
          <ProductArt product={product} height={56} width={56} fontSize={26} radius={14} showBadge={false} showUnavailable={false} />
          <div className="unit-sheet-header-body">
            <strong>{product.name}</strong>
            <span>{product.unit}</span>
          </div>
        </div>

        <div className="unit-sheet-options">
          {variants === null && <div className="unit-sheet-loading">{ar.common.loading}</div>}
          {variants !== null && variants.map(variant => {
            const quantity = selections[variant.id] ?? 0
            const outOfStock = variant.stock <= 0
            return (
              <div key={variant.id} className={`unit-sheet-option ${outOfStock ? 'unavailable' : ''}`}>
                <div className="unit-sheet-option-info">
                  <strong>{variant.name}</strong>
                  <span className="unit-sheet-option-price">{formatMoney(variant.price)}</span>
                  <span className={`stock-badge ${outOfStock ? 'unavailable' : variant.stock <= 5 ? 'low-stock' : 'available'}`}>
                    {outOfStock ? ar.unitSheet.outOfStock : variant.stock <= 5 ? ar.unitSheet.lowStockRemaining(variant.stock) : ar.unitSheet.available}
                  </span>
                </div>
                <div className="add-stepper md">
                  <button
                    type="button"
                    onClick={() => setVariantQuantity(variant, quantity - 1)}
                    disabled={quantity <= 0}
                    aria-label={ar.common.decreaseQty}
                  >−</button>
                  <span>{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setVariantQuantity(variant, quantity + 1)}
                    disabled={outOfStock || quantity >= variant.stock}
                    aria-label={ar.common.increaseQty}
                  >+</button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="unit-sheet-footer">
          <div className="unit-sheet-total">
            <span>{ar.unitSheet.selectedTotal}</span>
            <strong>{formatMoney(selectedTotal)}</strong>
          </div>
          <button type="button" className="unit-sheet-confirm" disabled={!hasSelection} onClick={confirm}>
            {ar.unitSheet.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}
