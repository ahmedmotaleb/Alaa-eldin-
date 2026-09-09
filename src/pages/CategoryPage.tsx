import { useParams } from 'react-router-dom'
import { ProductListScreen } from '../components/ProductListScreen'

export function CategoryPage() {
  const { categoryId } = useParams()
  return <ProductListScreen filters={{ category: categoryId }} filterKey={`category:${categoryId}`} />
}
