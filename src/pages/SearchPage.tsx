import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ProductArt } from '../components/ProductArt'
import { AddControl } from '../components/AddControl'
import { api, type ApiProduct } from '../utils/api'
import { formatMoney } from '../utils/money'
import { addRecentSearch, loadRecentSearches } from '../utils/recentSearches'
import { ar } from '../i18n/ar'

const DEBOUNCE_MS = 300

export function SearchPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [recents, setRecents] = useState<string[]>(() => loadRecentSearches())
  const [trending, setTrending] = useState<ApiProduct[]>([])
  const [results, setResults] = useState<ApiProduct[]>([])
  const [searching, setSearching] = useState(false)
  const requestToken = useRef(0)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    api.listProducts({ bestseller: true, limit: 5 }).then(({ products }) => setTrending(products)).catch(() => {})
  }, [])

  // بحث حقيقي من السيرفر بعد 300ms من توقف الكتابة (debounce) — مفيش طلب في كل ضغطة زر،
  // وأي رد من طلب قديم اتلغى (stale) بيتجاهل لو المستخدم غيّر النص قبل ما يوصل.
  useEffect(() => {
    const trimmed = query.trim()
    clearTimeout(debounceTimer.current)
    if (!trimmed) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceTimer.current = setTimeout(() => {
      const token = ++requestToken.current
      api.autocomplete(trimmed)
        .then(({ products }) => {
          if (token !== requestToken.current) return
          setResults(products)
          if (products.length > 0) addRecentSearch(trimmed)
        })
        .catch(() => { if (token === requestToken.current) setResults([]) })
        .finally(() => { if (token === requestToken.current) setSearching(false) })
    }, DEBOUNCE_MS)
    return () => clearTimeout(debounceTimer.current)
  }, [query])

  function pickRecent(term: string) {
    setQuery(term)
    setRecents(loadRecentSearches())
  }

  const trimmed = query.trim()

  return (
    <div className="search-page">
      <div className="search-input-bar">
        <span className="search-icon">⌕</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={ar.search.placeholder}
          autoFocus
        />
        {query && <button className="search-clear" onClick={() => setQuery('')}>×</button>}
      </div>

      {!trimmed && (
        <div className="search-suggestions">
          {recents.length > 0 && (
            <div>
              <h2>{ar.search.recentSearches}</h2>
              <div className="recent-chips">
                {recents.map(term => (
                  <button key={term} onClick={() => pickRecent(term)}>{term}</button>
                ))}
              </div>
            </div>
          )}
          <div>
            <h2>{ar.search.trending}</h2>
            <div className="trending-list">
              {trending.map(product => (
                <button key={product.id} className="trending-row" onClick={() => navigate(`/product/${product.slug}`)}>
                  <ProductArt product={product} height={40} width={40} fontSize={21} radius={13} showBadge={false} showUnavailable={false} />
                  <span className="trending-row-info">
                    <span className="trending-row-name">{product.name}</span>
                    <span className="trending-row-unit">{product.unit}</span>
                  </span>
                  <span className="trending-row-price">{formatMoney(product.price)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {trimmed && !searching && results.length > 0 && (
        <div>
          <div className="results-count">{ar.search.resultsCount(results.length)}</div>
          <div className="search-results">
            {results.map(product => (
              <div className="search-result-row" key={product.id}>
                <button className="search-result-art" onClick={() => navigate(`/product/${product.slug}`)}>
                  <ProductArt product={product} height={56} width={56} fontSize={27} radius={15} showBadge={false} showUnavailable={false} />
                </button>
                <button className="search-result-info" onClick={() => navigate(`/product/${product.slug}`)}>
                  <span className="search-result-name">{product.name}</span>
                  <span className="search-result-unit">{product.unit}</span>
                  <span className="search-result-price">{formatMoney(product.price)}</span>
                </button>
                <AddControl product={product} />
              </div>
            ))}
          </div>
        </div>
      )}

      {trimmed && trimmed.length >= 2 && !searching && results.length === 0 && (
        <div className="no-results-card">
          <div className="no-results-icon">🔍</div>
          <div className="no-results-title">{ar.search.noResultsTitle(trimmed)}</div>
          <div className="no-results-note">{ar.search.noResultsNote}</div>
          <button onClick={() => navigate('/categories')}>{ar.search.browseCategories}</button>
        </div>
      )}
    </div>
  )
}
