import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, type ApiContentPage } from '../utils/api'
import { setPageMeta } from '../utils/pageMeta'
import { ar } from '../i18n/ar'

// صفحة محتوى عامة (سياسة الاسترجاع والاستبدال، وأي صفحة مشابهة لاحقاً) — المحتوى بييجي
// من قاعدة البيانات ويتعرض كنص عادي (white-space: pre-wrap) من غير أي HTML، فمفيش أي
// حاجة تحتاج dangerouslySetInnerHTML أو sanitization هنا أصلاً.
export function ContentPage({ slug }: { slug: string }) {
  const navigate = useNavigate()
  const [page, setPage] = useState<ApiContentPage | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setPage(null)
    setNotFound(false)
    setError('')
    api.getPage(slug)
      .then(({ page }) => setPage(page))
      .catch(err => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true)
        else setError(ar.errors.generic)
      })
  }, [slug])

  useEffect(() => {
    if (!page) return
    setPageMeta({ title: page.title, description: page.content.slice(0, 160), path: `/${page.slug}` })
  }, [page])

  if (notFound) {
    return (
      <div className="content-page-not-found">
        <div className="content-page-not-found-icon">📄</div>
        <div className="content-page-not-found-title">هذه الصفحة غير متاحة حالياً</div>
        <button className="secondary-button" onClick={() => navigate('/')}>{ar.common.back}</button>
      </div>
    )
  }

  if (error) return <div className="form-error-banner">{error}</div>
  if (!page) return null

  return (
    <div className="content-page">
      <h1 className="content-page-title">{page.title}</h1>
      <div className="content-page-body">{page.content}</div>
    </div>
  )
}
