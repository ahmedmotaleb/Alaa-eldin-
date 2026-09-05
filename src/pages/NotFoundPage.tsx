import { useNavigate } from 'react-router-dom'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="empty-card">
      <h1>الصفحة غير موجودة</h1>
      <button className="primary-button" onClick={() => navigate('/')}>العودة للرئيسية</button>
    </div>
  )
}
