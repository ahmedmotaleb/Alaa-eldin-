import { useSearchParams } from 'react-router-dom'
import { SearchBar } from '../components/SearchBar'
import { ProductGrid } from '../components/ProductGrid'
import { products } from '../data/products'

export function SearchPage() {
  const [params] = useSearchParams()
  const query = (params.get('q') ?? '').trim()
  const matches = products.filter(product =>
    `${product.name} ${product.description}`.includes(query)
  )

  return (
    <section>
      <SearchBar />
      <div className="page-title">
        <h1>نتائج البحث</h1>
        <p>{query ? `نتائج البحث عن: ${query}` : 'اكتب اسم المنتج الذي تبحث عنه.'}</p>
      </div>
      <ProductGrid products={query ? matches : []} />
    </section>
  )
}
