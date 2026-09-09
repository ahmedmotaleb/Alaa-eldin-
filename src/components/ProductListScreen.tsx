import type { ListProductsParams, ProductSort } from '../utils/api'
import { useProductList } from '../hooks/useProductList'
import { ProductGrid } from './ProductGrid'
import { ar } from '../i18n/ar'

const SORT_OPTIONS: { id: ProductSort, label: string }[] = [
  { id: 'popular', label: ar.productList.sortPopular },
  { id: 'price_asc', label: ar.productList.sortLow },
  { id: 'price_desc', label: ar.productList.sortHigh }
]

// filters بيوصف الفلتر الثابت لهذه الشاشة (قسم مُحدد، أو offer=true، أو bestseller=true)؛
// filterKey لازم يكون قيمة مستقرة (زي معرف القسم) تتغير بس لو الفلتر الفعلي اتغير، عشان
// useProductList يعرف امتى يعيد الطلب من السيرفر.
export function ProductListScreen({ filters, filterKey }: { filters: Omit<ListProductsParams, 'page' | 'limit' | 'sort'>, filterKey: string }) {
  const { sort, setSort, products, loading, loadingMore, hasMore, loadMore } = useProductList(filters, filterKey)

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
        <>
          <ProductGrid products={products} />
          {hasMore && (
            <button className="load-more-button" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? ar.productList.loadingMore : ar.productList.loadMore}
            </button>
          )}
        </>
      )}
    </div>
  )
}
