import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { ProductListScreen } from '../components/ProductListScreen'
import { useCatalog } from '../store/CatalogContext'
import { setPageMeta } from '../utils/pageMeta'

export function CategoryPage() {
  const { categoryId } = useParams()
  const { categories } = useCatalog()
  const category = categories.find(c => c.id === categoryId)

  useEffect(() => {
    if (!category) return
    setPageMeta({
      title: category.name,
      description: `تسوق ${category.name} أونلاين مع توصيل سريع ودفع عند الاستلام`,
      path: `/category/${categoryId}`
    })
  }, [category, categoryId])

  return <ProductListScreen filters={{ category: categoryId }} filterKey={`category:${categoryId}`} />
}
