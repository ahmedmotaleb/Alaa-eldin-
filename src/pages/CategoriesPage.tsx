import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCatalog } from '../store/CatalogContext'
import { transformImage } from '../utils/image'
import { setPageMeta } from '../utils/pageMeta'
import { ar } from '../i18n/ar'

export function CategoriesPage() {
  const navigate = useNavigate()
  const { categories } = useCatalog()

  useEffect(() => {
    setPageMeta({ title: 'الأقسام', description: 'تصفح كل أقسام المتجر ومنتجاته', path: '/categories' })
  }, [])

  return (
    <div className="categories-grid">
      {categories.map(category => (
        <button key={category.id} className="category-card" onClick={() => navigate(`/category/${category.id}`)}>
          <span className="category-card-icon" style={{ background: category.image ? '#fff' : category.tint }}>
            {category.image ? <img src={transformImage(category.image, 'thumbnail')} alt="" loading="lazy" /> : (category.emoji || '🗂️')}
          </span>
          <span className="category-card-name">{category.name}</span>
          <span className="category-card-count">{ar.categories.productsCount(category.productCount)}</span>
        </button>
      ))}
    </div>
  )
}
