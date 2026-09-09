import { useEffect, useRef, useState } from 'react'
import { api, type ListProductsParams, type ProductSort } from '../utils/api'
import type { Product } from '../types/models'

export type { ProductSort as SortOption }

const PAGE_SIZE = 20

// كل الفلترة/الفرز/التقسيم لصفحات بيحصل في السيرفر (PostgreSQL) — من غير أي تأخير مصطنع.
// الهيكل العظمي (skeleton) بيتعرض بس وقت ما في طلب شبكة حقيقي شغال فعلاً؛ لو البيانات جاهزة
// فوراً (مثلاً صفحة تانية اتحملت قبل كده) بتتعرض على طول من غير أي انتظار وهمي.
export function useProductList(filters: Omit<ListProductsParams, 'page' | 'limit' | 'sort'>, filterKey: string) {
  const [sort, setSort] = useState<ProductSort>('popular')
  const [products, setProducts] = useState<Product[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestToken = useRef(0)

  useEffect(() => {
    const token = ++requestToken.current
    setLoading(true)
    setPage(1)
    api.listProducts({ ...filters, sort, page: 1, limit: PAGE_SIZE })
      .then(({ products: list, pagination }) => {
        if (token !== requestToken.current) return
        setProducts(list)
        setTotalPages(pagination.pages)
      })
      .catch(() => {
        if (token !== requestToken.current) return
        setProducts([])
        setTotalPages(1)
      })
      .finally(() => {
        if (token === requestToken.current) setLoading(false)
      })
    // filterKey بيلخّص كل قيم filters (بدل ما نحط الكائن نفسه كـ dependency ويعمل إعادة
    // طلب في كل render)؛ sort ليها تأثيرها المباشر برضه.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, sort])

  function loadMore() {
    if (loadingMore || page >= totalPages) return
    const token = requestToken.current
    const nextPage = page + 1
    setLoadingMore(true)
    api.listProducts({ ...filters, sort, page: nextPage, limit: PAGE_SIZE })
      .then(({ products: list, pagination }) => {
        if (token !== requestToken.current) return
        setProducts(current => [...current, ...list])
        setTotalPages(pagination.pages)
        setPage(nextPage)
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false))
  }

  return { sort, setSort, products, loading, loadingMore, hasMore: page < totalPages, loadMore }
}
