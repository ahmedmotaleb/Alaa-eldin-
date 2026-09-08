import { ProductListScreen } from '../components/ProductListScreen'
import { useCatalog } from '../store/CatalogContext'

export function OffersPage() {
  const { products } = useCatalog()
  const visible = products.filter(p => p.oldPrice)
  return <ProductListScreen products={visible} loadingKey="offers" />
}
