import { useEffect, useMemo, useState } from 'react'
import type { Product } from '../types/models'

export type SortOption = 'popular' | 'low' | 'high'

export function useProductList(baseProducts: Product[], loadingKey: string) {
  const [sort, setSort] = useState<SortOption>('popular')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => setLoading(false), 620)
    return () => clearTimeout(timer)
  }, [loadingKey])

  const sorted = useMemo(() => {
    const list = [...baseProducts]
    if (sort === 'low') list.sort((a, b) => a.price - b.price)
    else if (sort === 'high') list.sort((a, b) => b.price - a.price)
    else list.sort((a, b) => (b.orderCount ?? 0) - (a.orderCount ?? 0))
    return list
  }, [baseProducts, sort])

  return { sort, setSort, sorted, loading }
}
