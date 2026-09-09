import { ProductListScreen } from '../components/ProductListScreen'

export function BestSellersPage() {
  return <ProductListScreen filters={{ bestseller: true }} filterKey="best-sellers" />
}
