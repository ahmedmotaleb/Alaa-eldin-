import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ProductArt } from '../components/ProductArt'
import { AddControl } from '../components/AddControl'
import { useCatalog } from '../store/CatalogContext'
import { formatMoney } from '../utils/money'
import { addRecentSearch, loadRecentSearches } from '../utils/recentSearches'
import { ar } from '../i18n/ar'

export function SearchPage() {
  const navigate = useNavigate()
  const { products } = useCatalog()
  const [query, setQuery] = useState('')
  const [recents, setRecents] = useState<string[]>(() => loadRecentSearches())

  const trimmed = query.trim()
  const results = useMemo(
    () => trimmed ? products.filter(p => p.name.includes(trimmed) || p.description.includes(trimmed)) : [],
    [trimmed]
  )
  const trending = useMemo(() => products.filter(p => p.bestseller).slice(0, 5), [])

  useEffect(() => {
    if (trimmed && results.length > 0) addRecentSearch(trimmed)
  }, [trimmed, results.length])

  function pickRecent(term: string) {
    setQuery(term)
    setRecents(loadRecentSearches())
  }

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

      {trimmed && results.length > 0 && (
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

      {trimmed && results.length === 0 && (
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
