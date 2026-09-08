import type { Product } from '../types/models'
import { useProductList, type SortOption } from '../hooks/useProductList'
import { ProductGrid } from './ProductGrid'
import { ar } from '../i18n/ar'

const SORT_OPTIONS: { id: SortOption, label: string }[] = [
  { id: 'popular', label: ar.productList.sortPopular },
  { id: 'low', label: ar.productList.sortLow },
  { id: 'high', label: ar.productList.sortHigh }
]

export function ProductListScreen({ products, loadingKey }: { products: Product[], loadingKey: string }) {
  const { sort, setSort, sorted, loading } = useProductList(products, loadingKey)

  return (
    <div className="product-list-screen">
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
        <ProductGrid products={sorted} />
      )}
    </div>
  )
}
