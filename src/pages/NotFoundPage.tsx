import { useNavigate } from 'react-router-dom'
import { ar } from '../i18n/ar'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="empty-card">
      <h1>{ar.notFound.title}</h1>
      <button className="primary-button" onClick={() => navigate('/')}>{ar.notFound.backHome}</button>
    </div>
  )
}
