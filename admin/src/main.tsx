import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// service worker فارغ (بدون أي كاش) — بيتسجل بس عشان يستوفي شرط "تثبيت PWA حقيقي" في
// Chrome (زر "Install app" بأيقونة المتجر وشاشة كاملة)، وإلا المتصفح بياخد صورة شاشة
// للصفحة كأيقونة بدل أيقونة الـ manifest الحقيقية. راجع public/sw.js للتفاصيل.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }).catch(() => {})
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
