import { useNavigate } from 'react-router-dom'
import { useCatalog } from '../store/CatalogContext'
import { ar } from '../i18n/ar'

export function CategoriesPage() {
  const navigate = useNavigate()
  const { categories } = useCatalog()

  return (
    <div className="categories-grid">
      {categories.map(category => (
        <button key={category.id} className="category-card" onClick={() => navigate(`/category/${category.id}`)}>
          <span className="category-card-icon" style={{ background: category.tint }}>{category.emoji}</span>
          <span className="category-card-name">{category.name}</span>
          <span className="category-card-count">{ar.categories.productsCount(category.productCount)}</span>
        </button>
      ))}
    </div>
  )
}
