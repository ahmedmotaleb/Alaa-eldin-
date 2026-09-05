import { useNavigate } from 'react-router-dom'
import { SearchBar } from '../components/SearchBar'
import { ProductGrid } from '../components/ProductGrid'
import { Section } from '../components/Section'
import { categories } from '../data/categories'
import { products } from '../data/products'

export function HomePage() {
  const navigate = useNavigate()

  return (
    <>
      <SearchBar />

      <section className="promo-slider" aria-label="العروض">
        <div className="promo-card">
          <div>
            <span className="promo-kicker">وفر في طلب البيت</span>
            <h1>خصومات يومية على احتياجاتك</h1>
            <button onClick={() => navigate('/categories')}>تسوق الآن</button>
          </div>
          <div className="promo-emoji">🛍️</div>
        </div>
        <div className="slider-dots" aria-hidden="true"><span></span><span></span><span></span></div>
      </section>

      <div className="category-chips">
        {categories.map(category => (
          <button key={category.id} onClick={() => navigate(`/category/${category.id}`)}>
            <span>{category.emoji}</span>{category.name}
          </button>
        ))}
      </div>

      <Section title="الأكثر مبيعاً">
        <ProductGrid products={products.filter(p => p.bestseller).slice(0, 6)} />
      </Section>

      <Section title="عروض اليوم">
        <ProductGrid products={products.filter(p => p.offer).slice(0, 6)} />
      </Section>

      <Section title="وصل حديثاً">
        <ProductGrid products={products.filter(p => p.newArrival).slice(0, 6)} />
      </Section>
    </>
  )
}
