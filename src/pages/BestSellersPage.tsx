import { ProductListScreen } from '../components/ProductListScreen'
import { useCatalog } from '../store/CatalogContext'

export function BestSellersPage() {
  const { products } = useCatalog()
  const visible = products.filter(p => p.bestseller)
  return <ProductListScreen products={visible} loadingKey="best-sellers" />
}
