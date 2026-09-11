import { useEffect } from 'react'
import { ProductListScreen } from '../components/ProductListScreen'
import { setPageMeta } from '../utils/pageMeta'

export function OffersPage() {
  useEffect(() => {
    setPageMeta({ title: 'عروض اليوم', description: 'أحدث عروض وخصومات المتجر لهذا اليوم', path: '/offers' })
  }, [])

  return <ProductListScreen filters={{ offer: true }} filterKey="offers" />
}
