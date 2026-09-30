import { useEffect, useMemo, useRef, useState } from 'react'
import type { ListProductsParams, ProductSort } from '../utils/api'
import { useProductList } from '../hooks/useProductList'
import { ProductGrid } from './ProductGrid'
import { FilterSheet, EMPTY_FILTER_STATE, activeFilterCount, type FilterState } from './FilterSheet'
import { formatMoney } from '../utils/money'
import { ar } from '../i18n/ar'

const SORT_OPTIONS: { id: ProductSort, label: string }[] = [
  { id: 'popular', label: ar.productList.sortPopular },
  { id: 'price_asc', label: ar.productList.sortLow },
  { id: 'price_desc', label: ar.productList.sortHigh }
]

const SEARCH_DEBOUNCE_MS = 300

// filters بيوصف الفلتر الثابت لهذه الشاشة (قسم مُحدد، أو offer=true، أو bestseller=true)؛
// filterKey لازم يكون قيمة مستقرة (زي معرف القسم) تتغير بس لو الفلتر الفعلي اتغير. البحث
// وفلاتر الشيت المتقدمة (سعر/توفر/عروض/براند/وحدة) بتتضاف فوق نفس الفلتر الثابت ده — نفس
// endpoint المنتجات الموجود (GET /api/products)، بدون أي نظام بحث أو تحميل كتالوج تاني.
export function ProductListScreen({
  filters, filterKey, searchPlaceholder
}: {
  filters: Omit<ListProductsParams, 'page' | 'limit' | 'sort'>
  filterKey: string
  searchPlaceholder: string
}) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [filterState, setFilterState] = useState<FilterState>(EMPTY_FILTER_STATE)
  const [sheetOpen, setSheetOpen] = useState(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(debounceTimer.current)
  }, [query])

  const showOfferToggle = !filters.offer

  const mergedFilters = useMemo<Omit<ListProductsParams, 'page' | 'limit' | 'sort'>>(() => ({
    ...filters,
    search: debouncedQuery || undefined,
    available: filterState.available || undefined,
    offer: filters.offer || (filterState.offerOnly || undefined),
    minPrice: filterState.minPrice.trim() ? Number(filterState.minPrice) : undefined,
    maxPrice: filterState.maxPrice.trim() ? Number(filterState.maxPrice) : undefined,
    brand: filterState.brand || undefined,
    unit: filterState.unit || undefined
  }), [filters, debouncedQuery, filterState])

  const effectiveKey = `${filterKey}:${JSON.stringify(mergedFilters)}`
  const { sort, setSort, products, loading, loadingMore, hasMore, loadMore } = useProductList(mergedFilters, effectiveKey)

  const filterCount = activeFilterCount(filterState)

  function removeChip(patch: Partial<FilterState>) {
    setFilterState(current => ({ ...current, ...patch }))
  }

  return (
    <div className="product-list-screen">
      <div className="search-input-bar product-search-bar-sticky">
        <span className="search-icon">⌕</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
        />
        {query && <button className="search-clear" aria-label={ar.filters.clearSearchAriaLabel} onClick={() => setQuery('')}>×</button>}
      </div>

      <div className="product-list-toolbar">
        <div className="sort-pills">
          {SORT_OPTIONS.map(option => (
            <button
              key={option.id}
              className={sort === option.id ? 'active' : ''}
              onClick={() => setSort(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button className="filter-open-button" onClick={() => setSheetOpen(true)}>
          <span>⚙</span>
          {filterCount > 0 ? ar.filters.titleWithCount(filterCount) : ar.filters.title}
        </button>
      </div>

      {filterCount > 0 && (
        <div className="filter-chips">
          {filterState.available && (
            <button className="filter-chip" onClick={() => removeChip({ available: false })}>
              {ar.filters.chipAvailable} <span aria-label={ar.filters.removeFilterAriaLabel(ar.filters.chipAvailable)}>×</span>
            </button>
          )}
          {filterState.offerOnly && (
            <button className="filter-chip" onClick={() => removeChip({ offerOnly: false })}>
              {ar.filters.chipOffer} <span aria-label={ar.filters.removeFilterAriaLabel(ar.filters.chipOffer)}>×</span>
            </button>
          )}
          {filterState.minPrice.trim() && (
            <button className="filter-chip" onClick={() => removeChip({ minPrice: '' })}>
              {ar.filters.chipMinPrice(formatMoney(Number(filterState.minPrice)))} <span>×</span>
            </button>
          )}
          {filterState.maxPrice.trim() && (
            <button className="filter-chip" onClick={() => removeChip({ maxPrice: '' })}>
              {ar.filters.chipMaxPrice(formatMoney(Number(filterState.maxPrice)))} <span>×</span>
            </button>
          )}
          {filterState.brand && (
            <button className="filter-chip" onClick={() => removeChip({ brand: '' })}>
              {ar.filters.chipBrand(filterState.brand)} <span>×</span>
            </button>
          )}
          {filterState.unit && (
            <button className="filter-chip" onClick={() => removeChip({ unit: '' })}>
              {ar.filters.chipUnit(filterState.unit)} <span>×</span>
            </button>
          )}
          <button className="filter-chip-clear" onClick={() => setFilterState(EMPTY_FILTER_STATE)}>{ar.filters.clearAll}</button>
        </div>
      )}

      {loading ? (
        <div className="product-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="product-skeleton" key={i}>
              <div className="skeleton-shimmer skeleton-art" />
              <div className="skeleton-body">
                <div className="skeleton-shimmer skeleton-line" />
                <div className="skeleton-line-static" />
                <div className="skeleton-line-block" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <ProductGrid products={products} />
          {hasMore && (
            <button className="load-more-button" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? ar.productList.loadingMore : ar.productList.loadMore}
            </button>
          )}
        </>
      )}

      {sheetOpen && (
        <FilterSheet
          facetsContext={{ category: filters.category, search: debouncedQuery || undefined, offer: filters.offer, bestseller: filters.bestseller }}
          showOfferToggle={showOfferToggle}
          value={filterState}
          onChange={setFilterState}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  )
}
