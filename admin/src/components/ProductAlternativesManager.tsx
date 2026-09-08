import { useEffect, useState } from 'react'
import { api, type AdminAlternativeProduct, type AdminProduct } from '../utils/api'

export function ProductAlternativesManager({ productId }: { productId: string }) {
  const [alternatives, setAlternatives] = useState<AdminAlternativeProduct[]>([])
  const [allProducts, setAllProducts] = useState<AdminProduct[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.listProductAlternatives(productId), api.listProducts()])
      .then(([altRes, prodRes]) => {
        setAlternatives(altRes.alternatives)
        setAllProducts(prodRes.products)
      })
      .catch(() => setError('تعذر تحميل البدائل المشابهة'))
      .finally(() => setLoading(false))
  }, [productId])

  const candidateProducts = allProducts.filter(p => p.id !== productId && !alternatives.some(a => a.id === p.id))

  async function addSelected() {
    if (!selected) return
    setError('')
    try {
      const { alternatives } = await api.addProductAlternative(productId, selected)
      setAlternatives(alternatives)
      setSelected('')
    } catch {
      setError('تعذر إضافة البديل')
    }
  }

  async function remove(alternativeProductId: string) {
    const previous = alternatives
    setAlternatives(current => current.filter(a => a.id !== alternativeProductId))
    try {
      await api.removeProductAlternative(productId, alternativeProductId)
    } catch {
      setError('تعذر حذف البديل')
      setAlternatives(previous)
    }
  }

  if (loading) return null

  return (
    <div className="admin-form-card">
      <div>
        <div className="admin-form-card-title">بدائل مشابهة</div>
        <div className="admin-form-card-sub">تظهر للعميل كاقتراحات في صفحة المنتج فقط — لا تستبدل المنتج تلقائياً في أي مكان</div>
      </div>

      {error && <div className="admin-form-error">{error}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {alternatives.map(a => (
          <span key={a.id} className="admin-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F1F4F2' }}>
            {a.emoji} {a.name}
            <button type="button" onClick={() => remove(a.id)} aria-label={`حذف ${a.name} من البدائل`} style={{ border: 'none', background: 'none', color: '#B42318', fontWeight: 900, cursor: 'pointer', padding: 0 }}>×</button>
          </span>
        ))}
        {alternatives.length === 0 && <span style={{ fontSize: 12.5, color: '#8A948C' }}>مفيش بدائل مضافة لسه</span>}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <select value={selected} onChange={e => setSelected(e.target.value)} style={{ flex: 1, border: '1px solid #dce4de', borderRadius: 11, padding: '10px 12px', fontWeight: 600, fontSize: 13 }}>
          <option value="">اختر منتج لإضافته كبديل...</option>
          {candidateProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" className="admin-form-chip" onClick={addSelected} disabled={!selected}>إضافة</button>
      </div>
    </div>
  )
}
