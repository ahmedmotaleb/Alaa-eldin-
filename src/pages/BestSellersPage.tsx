import { useEffect } from 'react'
import { ProductListScreen } from '../components/ProductListScreen'
import { setPageMeta } from '../utils/pageMeta'
import { ar } from '../i18n/ar'

export function BestSellersPage() {
  useEffect(() => {
    setPageMeta({ title: 'الأكثر مبيعاً', description: 'المنتجات الأكثر طلباً في المتجر', path: '/best-sellers' })
  }, [])

  return <ProductListScreen filters={{ bestseller: true }} filterKey="best-sellers" searchPlaceholder={ar.filters.searchPlaceholderBestSellers} />
}
