import { useEffect, useRef, useState } from 'react'
import { api, type ApiProductFacets, type ListProductsParams } from '../utils/api'
import { ar } from '../i18n/ar'

export interface FilterState {
  available: boolean
  offerOnly: boolean
  minPrice: string
  maxPrice: string
  brand: string
  unit: string
}

export const EMPTY_FILTER_STATE: FilterState = { available: false, offerOnly: false, minPrice: '', maxPrice: '', brand: '', unit: '' }

export function activeFilterCount(f: FilterState): number {
  let n = 0
  if (f.available) n++
  if (f.offerOnly) n++
  if (f.minPrice.trim()) n++
  if (f.maxPrice.trim()) n++
  if (f.brand) n++
  if (f.unit) n++
  return n
}

interface FilterSheetProps {
  facetsContext: Pick<ListProductsParams, 'category' | 'search' | 'offer' | 'bestseller'>
  showOfferToggle: boolean
  value: FilterState
  onChange: (next: FilterState) => void
  onClose: () => void
}

// شيت الفلترة المتقدمة — بيحمّل خيارات البراند/الوحدة الحقيقية المتاحة فعلاً (من
// GET /products/facets) بنفس سياق القسم/البحث/العرض/الأكثر مبيعاً الحالي، من غير ما يفترض
// قيم ثابتة أو يحمّل الكتالوج كامل. لو مفيش برندات أو وحدات حقيقية أصلاً، القسم بيختفي
// تماماً بدل ما يعرض قايمة فاضية.
export function FilterSheet({ facetsContext, showOfferToggle, value, onChange, onClose }: FilterSheetProps) {
  const [facets, setFacets] = useState<ApiProductFacets | null>(null)
  const [draft, setDraft] = useState<FilterState>(value)
  const sheetRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<Element | null>(null)

  useEffect(() => {
    api.getProductFacets({ ...facetsContext, available: draft.available || undefined })
      .then(setFacets)
      .catch(() => setFacets({ brands: [], units: [] }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.available])

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

  function set<K extends keyof FilterState>(key: K, v: FilterState[K]) {
    setDraft(current => ({ ...current, [key]: v }))
  }

  function apply() {
    onChange(draft)
    onClose()
  }

  function clearAll() {
    setDraft(EMPTY_FILTER_STATE)
    onChange(EMPTY_FILTER_STATE)
    onClose()
  }

  return (
    <div className="filter-sheet-backdrop" onClick={onClose}>
      <div
        className="filter-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={ar.filters.title}
        tabIndex={-1}
        ref={sheetRef}
        onClick={e => e.stopPropagation()}
      >
        <div className="unit-sheet-handle" />
        <button type="button" className="unit-sheet-close" onClick={onClose} aria-label={ar.common.close}>✕</button>
        <strong className="filter-sheet-title">{ar.filters.title}</strong>

        <div className="filter-sheet-body">
          <div className="filter-section">
            <div className="filter-section-title">{ar.filters.priceTitle}</div>
            <div className="filter-price-row">
              <input
                type="number" inputMode="decimal" min={0} className="filter-price-input"
                placeholder={ar.filters.minPricePlaceholder}
                value={draft.minPrice}
                onChange={e => set('minPrice', e.target.value)}
              />
              <span className="filter-price-sep">—</span>
              <input
                type="number" inputMode="decimal" min={0} className="filter-price-input"
                placeholder={ar.filters.maxPricePlaceholder}
                value={draft.maxPrice}
                onChange={e => set('maxPrice', e.target.value)}
              />
            </div>
          </div>

          <label className="filter-toggle-row">
            <input type="checkbox" checked={draft.available} onChange={e => set('available', e.target.checked)} />
            {ar.filters.availableOnly}
          </label>

          {showOfferToggle && (
            <label className="filter-toggle-row">
              <input type="checkbox" checked={draft.offerOnly} onChange={e => set('offerOnly', e.target.checked)} />
              {ar.filters.offersOnly}
            </label>
          )}

          {facets && facets.brands.length > 0 && (
            <div className="filter-section">
              <div className="filter-section-title">{ar.filters.brandTitle}</div>
              <select value={draft.brand} onChange={e => set('brand', e.target.value)}>
                <option value="">{ar.filters.allBrands}</option>
                {facets.brands.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          )}

          {facets && facets.units.length > 0 && (
            <div className="filter-section">
              <div className="filter-section-title">{ar.filters.unitTitle}</div>
              <select value={draft.unit} onChange={e => set('unit', e.target.value)}>
                <option value="">{ar.filters.allUnits}</option>
                {facets.units.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="filter-sheet-footer">
          <button type="button" className="secondary-button" onClick={clearAll}>{ar.filters.clearAll}</button>
          <button type="button" className="primary-button" onClick={apply}>{ar.filters.apply}</button>
        </div>
      </div>
    </div>
  )
}
