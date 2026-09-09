import { ProductListScreen } from '../components/ProductListScreen'

export function OffersPage() {
  return <ProductListScreen filters={{ offer: true }} filterKey="offers" />
}
