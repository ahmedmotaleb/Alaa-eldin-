import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ProductGrid } from '../components/ProductGrid'
import { Section } from '../components/Section'
import { useCatalog } from '../store/CatalogContext'
import { hasOnboarded } from '../utils/onboarding'
import { api, type ApiBanner, type ApiProduct } from '../utils/api'
import { getSettings } from '../store/settingsStore'
import { ar } from '../i18n/ar'

const HOME_SECTION_LIMIT = 6

export function HomePage() {
  const navigate = useNavigate()
  const { categories } = useCatalog()
  const settings = getSettings()
  const [banners, setBanners] = useState<ApiBanner[]>([])
  const [bannerIndex, setBannerIndex] = useState(0)
  const [offers, setOffers] = useState<ApiProduct[]>([])
  const [bestsellers, setBestsellers] = useState<ApiProduct[]>([])

  useEffect(() => {
    api.listBanners().then(({ banners }) => setBanners(banners)).catch(() => {})
  }, [])

  // الصفحة الرئيسية بتجيب بس 6 عروض و6 الأكثر مبيعاً من السيرفر مباشرة — مش بتحمّل الكتالوج
  // كامل عشان تعرض 12 منتج بس.
  useEffect(() => {
    if (settings.showTodaysOffers) {
      api.listProducts({ offer: true, limit: HOME_SECTION_LIMIT }).then(({ products }) => setOffers(products)).catch(() => {})
    }
    if (settings.showBestSellers) {
      api.listProducts({ bestseller: true, limit: HOME_SECTION_LIMIT }).then(({ products }) => setBestsellers(products)).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.showTodaysOffers, settings.showBestSellers])

  if (!hasOnboarded()) return <Navigate to="/onboarding" replace />

  const banner = banners[bannerIndex]

  return (
    <>
      {banner && (
        <div className="promo-hero">
          <div>
            {banner.kicker && <div className="promo-hero-kicker">{banner.kicker}</div>}
            <div className="promo-hero-title">{banner.title}</div>
            {banner.note && <div className="promo-hero-note">{banner.note}</div>}
            <button onClick={() => navigate(banner.link)}>{banner.ctaLabel}</button>
          </div>
          <div className="promo-hero-emoji">{banner.emoji}</div>
        </div>
      )}
      {banners.length > 1 && (
        <div className="promo-dots">
          {banners.map((b, i) => (
            <button key={b.id} className={`promo-dot ${i === bannerIndex ? 'active' : ''}`} onClick={() => setBannerIndex(i)} aria-label={`عرض ${i + 1}`} />
          ))}
        </div>
      )}

      <Section title={ar.home.sectionsTitle} action={<button className="section-link" onClick={() => navigate('/categories')}>{ar.common.viewAll}</button>}>
        <div className="category-rail">
          {categories.map(category => (
            <button key={category.id} className="category-rail-item" onClick={() => navigate(`/category/${category.id}`)}>
              <span className="category-rail-icon" style={{ background: category.tint }}>{category.emoji}</span>
              <span>{category.name}</span>
            </button>
          ))}
        </div>
      </Section>

      {settings.showTodaysOffers && (
        <Section
          title={ar.home.todaysOffersTitle}
          subtitle={ar.home.offersEndIn}
          action={<button className="section-link pill" onClick={() => navigate('/offers')}>{ar.home.allOffers}</button>}
        >
          <ProductGrid products={offers} layout="rail" />
        </Section>
      )}

      {settings.showBestSellers && (
        <Section title={ar.home.bestSellersTitle} action={<button className="section-link" onClick={() => navigate('/best-sellers')}>{ar.common.viewAll}</button>}>
          <ProductGrid products={bestsellers} />
        </Section>
      )}

      <div className="info-card">
        <div className="info-card-icon">🕑</div>
        <div>
          <div className="info-card-title">{ar.home.orderBeforeTitle}</div>
          <div className="info-card-note">{ar.home.orderBeforeNote}</div>
        </div>
      </div>
    </>
  )
}
