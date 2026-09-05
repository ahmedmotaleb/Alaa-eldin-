import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ProductGrid } from '../components/ProductGrid'
import { categories } from '../data/categories'
import { products } from '../data/products'

type SortValue = 'low' | 'high' | 'popular'

export function CategoryPage() {
  const { categoryId } = useParams()
  const [sort, setSort] = useState<SortValue>('popular')
  const category = categories.find(c => c.id === categoryId)

  const visible = useMemo(() => {
    const list = products.filter(p => p.categoryId === categoryId)
    return [...list].sort((a, b) => {
      if (sort === 'low') return a.price - b.price
      if (sort === 'high') return b.price - a.price
      return (b.orderCount ?? 0) - (a.orderCount ?? 0)
    })
  }, [categoryId, sort])

  return (
    <section>
      <div className="page-title split-title">
        <div>
          <h1>{category?.name ?? 'المنتجات'}</h1>
          <p>{visible.length} منتج</p>
        </div>
        <select value={sort} onChange={e => setSort(e.target.value as SortValue)} aria-label="ترتيب المنتجات">
          <option value="low">السعر من الأقل للأعلى</option>
          <option value="high">من الأعلى للأقل</option>
          <option value="popular">الأكثر طلباً</option>
        </select>
      </div>
      <ProductGrid products={visible} />
    </section>
  )
}
