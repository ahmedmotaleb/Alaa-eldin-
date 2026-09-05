import { useNavigate } from 'react-router-dom'
import { categories } from '../data/categories'

export function CategoriesPage() {
  const navigate = useNavigate()

  return (
    <section>
      <div className="page-title">
        <h1>الأقسام</h1>
        <p>اختار القسم المناسب وابدأ التسوق.</p>
      </div>

      <div className="category-grid">
        {categories.map(category => (
          <button className="category-card" key={category.id} onClick={() => navigate(`/category/${category.id}`)}>
            <span>{category.emoji}</span>
            <strong>{category.name}</strong>
          </button>
        ))}
      </div>
    </section>
  )
}
