import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, type BulkBatch, type BulkBatchDetail } from '../../utils/api'
import { formatCurrency, formatDateTime, formatQuantity } from '../../utils/format'
import type { LayoutContext } from '../../components/AdminLayout'

const OPERATION_LABEL: Record<BulkBatch['operationType'], string> = {
  bulk_price_csv: 'تحديث أسعار بالجملة (CSV)', bulk_price_adjustment: 'تعديل أسعار سريع',
  bulk_stock_csv: 'تحديث مخزون بالجملة (CSV)', bulk_stock_adjustment: 'تعديل مخزون سريع',
  bulk_cost_csv: 'تحديث تكلفة بالجملة (CSV)'
}
const STATUS_LABEL: Record<BulkBatch['status'], string> = {
  completed: 'مكتملة', rolled_back: 'تم التراجع بالكامل', partially_rolled_back: 'تراجع جزئي'
}
const STATUS_COLOR: Record<BulkBatch['status'], string> = {
  completed: '#2563EB', rolled_back: '#8A948C', partially_rolled_back: '#B45309'
}

export function BulkOperationsPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [batches, setBatches] = useState<BulkBatch[] | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<BulkBatchDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [rollbackNotice, setRollbackNotice] = useState<Record<string, string>>({})

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: 'العمليات الجماعية' })
  }, [setHeader])

  function reload() {
    api.listBulkPricingBatches().then(({ batches }) => setBatches(batches)).catch(() => setError('تعذر تحميل العمليات'))
  }

  useEffect(() => { reload() }, [])

  async function openDetail(id: string) {
    if (openId === id) { setOpenId(null); setDetail(null); return }
    setOpenId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const d = await api.getBulkPricingBatch(id)
      setDetail(d)
    } catch {
      setError('تعذر تحميل تفاصيل العملية')
    } finally {
      setDetailLoading(false)
    }
  }

  async function rollback(id: string) {
    if (!window.confirm('سيتم التراجع عن كل تغييرات هذه العملية اللي لسه لم تتعدل يدوياً بعدها. الصفوف اللي اتعدلت يدوياً بعد العملية هتتحفظ كـ"تعارض" بدون أي لمس. هل تريد المتابعة؟')) return
    setRollingBack(true)
    try {
      const result = await api.rollbackBulkPricingBatch(id)
      setRollbackNotice(cur => ({ ...cur, [id]: `تم التراجع عن ${result.rolledBackPrice} سعر و${result.rolledBackCost} تكلفة — ${result.conflicts} تعارض لم يُلمس` }))
      reload()
      if (openId === id) openDetail2(id)
    } catch {
      setRollbackNotice(cur => ({ ...cur, [id]: 'تعذر تنفيذ التراجع' }))
    } finally {
      setRollingBack(false)
    }
  }

  async function openDetail2(id: string) {
    setDetailLoading(true)
    try {
      setDetail(await api.getBulkPricingBatch(id))
    } catch { /* تجاهل */ } finally {
      setDetailLoading(false)
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!batches) return null

  return (
    <div className="admin-table-card">
      <div className="admin-table-scroll">
        <div style={{ minWidth: 900 }}>
          <div className="admin-table-head" style={{ gridTemplateColumns: '1.4fr .9fr .7fr .7fr .7fr 1fr .9fr' }}>
            <div>النوع</div><div>الحالة</div><div>الإجمالي</div><div>ناجح</div><div>فاشل</div><div>التاريخ</div><div></div>
          </div>
          {batches.length === 0 && <div style={{ padding: 20, color: '#8A948C' }}>لا توجد عمليات جماعية بعد</div>}
          {batches.map(batch => (
            <div key={batch.id}>
              <div className="admin-table-row" style={{ gridTemplateColumns: '1.4fr .9fr .7fr .7fr .7fr 1fr .9fr' }}>
                <div className="admin-cell-plain">{OPERATION_LABEL[batch.operationType]}</div>
                <div className="admin-cell-plain" style={{ fontWeight: 700, color: STATUS_COLOR[batch.status] }}>{STATUS_LABEL[batch.status]}</div>
                <div className="admin-cell-plain">{batch.totalRows}</div>
                <div className="admin-cell-plain">{batch.successfulRows}</div>
                <div className="admin-cell-plain">{batch.failedRows}</div>
                <div className="admin-cell-plain">{formatDateTime(batch.createdAt)}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="admin-form-chip" onClick={() => openDetail(batch.id)}>{openId === batch.id ? 'إخفاء' : 'التفاصيل'}</button>
                  {batch.status !== 'rolled_back' && (
                    <button className="admin-form-chip" disabled={rollingBack} onClick={() => rollback(batch.id)}>تراجع</button>
                  )}
                </div>
              </div>
              {rollbackNotice[batch.id] && (
                <div className="admin-form-success" style={{ margin: '0 16px 8px' }}>{rollbackNotice[batch.id]}</div>
              )}
              {openId === batch.id && (
                <div style={{ padding: '8px 16px 16px', background: '#FAFBFA' }}>
                  {detailLoading && <div>جاري التحميل...</div>}
                  {detail && detail.batch.id === batch.id && (
                    <>
                      {detail.priceChanges.length > 0 && (
                        <>
                          <div style={{ fontWeight: 700, marginBottom: 6 }}>تغييرات السعر ({detail.priceChanges.length})</div>
                          {detail.priceChanges.map((c, i) => (
                            <div key={i} style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px solid #EEF1EE' }}>
                              {c.productId}{c.variantId ? ` (${c.variantId})` : ''} — {formatCurrency(c.oldPrice)} ← {formatCurrency(c.newPrice)}
                              <span style={{ color: '#8A948C' }}> · {c.source} · {formatDateTime(c.createdAt)}</span>
                            </div>
                          ))}
                        </>
                      )}
                      {detail.costChanges.length > 0 && (
                        <>
                          <div style={{ fontWeight: 700, margin: '10px 0 6px' }}>تغييرات التكلفة ({detail.costChanges.length})</div>
                          {detail.costChanges.map((c, i) => (
                            <div key={i} style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px solid #EEF1EE' }}>
                              {c.productId}{c.variantId ? ` (${c.variantId})` : ''} — {c.oldCost !== null ? formatCurrency(c.oldCost) : 'بدون'} ← {formatCurrency(c.newCost)}
                              <span style={{ color: '#8A948C' }}> · {formatDateTime(c.createdAt)}</span>
                            </div>
                          ))}
                        </>
                      )}
                      {detail.stockChanges.length > 0 && (
                        <>
                          <div style={{ fontWeight: 700, margin: '10px 0 6px' }}>تغييرات المخزون ({detail.stockChanges.length})</div>
                          {detail.stockChanges.map((c, i) => (
                            <div key={i} style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px solid #EEF1EE' }}>
                              {c.productId}{c.variantId ? ` (${c.variantId})` : ''} — {c.quantityBefore !== null ? formatQuantity(c.quantityBefore) : '؟'} ← {c.quantityAfter !== null ? formatQuantity(c.quantityAfter) : '؟'}
                              <span style={{ color: '#8A948C' }}> · {c.type} · {formatDateTime(c.createdAt)}</span>
                            </div>
                          ))}
                        </>
                      )}
                      {detail.priceChanges.length === 0 && detail.costChanges.length === 0 && detail.stockChanges.length === 0 && (
                        <div style={{ color: '#8A948C' }}>لا توجد تفاصيل مسجّلة لهذه العملية</div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
