const KEY = 'alaa-eldin-recent-searches'
const MAX = 6
const DEFAULTS = ['لبن', 'أرز', 'جبنة', 'مياه']

export function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as string[] : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function addRecentSearch(query: string) {
  const trimmed = query.trim()
  if (!trimmed) return
  const current = loadRecentSearches().filter(q => q !== trimmed)
  const next = [trimmed, ...current].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // storage unavailable, ignore
  }
}
