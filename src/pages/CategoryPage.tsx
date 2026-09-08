import { useParams } from 'react-router-dom'
import { ProductListScreen } from '../components/ProductListScreen'
import { useCatalog } from '../store/CatalogContext'

export function CategoryPage() {
  const { categoryId } = useParams()
  const { products } = useCatalog()
  const visible = products.filter(p => p.categoryId === categoryId)

  return <ProductListScreen products={visible} loadingKey={`category:${categoryId}`} />
}
