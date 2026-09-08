import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { StatsGrid } from '../components/StatsGrid'
import { OrderTable } from '../components/OrderTable'
import { OrderDrawer } from '../components/OrderDrawer'
import {
  api, ApiError,
  type AdminOrder, type AdminOrderStatus, type AdminRider, type AdminSettlement, type AdminExpense
} from '../utils/api'
import { formatMoney } from '../utils/money'
import { NAV } from '../nav'
import type { LayoutContext } from '../components/AdminLayout'

const WALLET_NAV = NAV.find(g => g.id === 'wallet')!

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function WalletChart({ orders, days }: { orders: AdminOrder[], days: number }) {
  const buckets = useMemo(() => {
    const today = startOfDay(new Date())
    const list: { date: Date, total: number, count: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      list.push({ date: d, total: 0, count: 0 })
    }
    for (const order of orders) {
      const day = startOfDay(new Date(order.createdAt)).getTime()
      const bucket = list.find(b => b.date.getTime() === day)
      if (bucket) { bucket.total += order.total; bucket.count += 1 }
    }
    const max = Math.max(1, ...list.map(b => b.total))
    return list.map(b => ({
      label: String(b.date.getDate()),
      value: b.total >= 1000 ? Math.round(b.total / 1000) + 'k' : String(Math.round(b.total)),
      h: Math.round((b.total / max) * 100) + '%'
    }))
  }, [orders, days])

  return (
    <div className="admin-chart-card">
      <div className="admin-chart-head">
        <div>
          <div className="admin-chart-title">الكاش المحصّل</div>
          <div className="admin-chart-sub">آخر {days} يوم — من الطلبات التي تم تسليمها فعلياً</div>
        </div>
      </div>
      <div className="admin-chart-bars">
        {buckets.map((d, i) => (
          <div className="admin-chart-col" key={i}>
            <div className="admin-chart-value">{d.value}</div>
            <div className="admin-chart-bar-group" style={{ height: d.h }}>
              <div className="admin-chart-bar" style={{ background: '#16A34A', height: '100%', flex: 1 }} />
            </div>
            <div className="admin-chart-label">{d.label}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#8A948C', marginTop: 10 }}>
        التاريخ المعروض هو تاريخ إنشاء الطلب — النظام حالياً لا يسجّل وقت تسليم منفصل عن وقت الإنشاء.
      </div>
    </div>
  )
}

export function WalletPage({ tab: tabProp }: { tab?: string } = {}) {
  const params = useParams()
  const tab = tabProp ?? params.tab
  const { setHeader } = useOutletContext<LayoutContext>()
  const activeTab = tab && WALLET_NAV.children.find(c => c.id === tab) ? tab : 'overview'
  const tabLabel = WALLET_NAV.children.find(c => c.id === activeTab)?.label ?? 'نظرة عامة'

  const [orders, setOrders] = useState<AdminOrder[] | null>(null)
  const [riders, setRiders] = useState<AdminRider[]>([])
  const [settlements, setSettlements] = useState<AdminSettlement[]>([])
  const [expenses, setExpenses] = useState<AdminExpense[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<AdminOrder | null>(null)

  function load() {
    api.listOrders()
      .then(({ orders }) => setOrders(orders))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل بيانات المحفظة' : 'حدث خطأ، حاول مرة أخرى'))
  }
  function loadRiders() {
    api.listRiders().then(({ riders }) => setRiders(riders)).catch(() => {})
  }
  function loadSettlements() {
    api.listSettlements().then(({ settlements }) => setSettlements(settlements)).catch(() => {})
  }
  function loadExpenses() {
    api.listExpenses().then(({ expenses }) => setExpenses(expenses)).catch(() => {})
  }

  useEffect(() => { load(); loadRiders(); loadSettlements(); loadExpenses() }, [])

  useEffect(() => {
    setHeader({ crumb: 'المحفظة', title: tabLabel })
  }, [tabLabel, setHeader])

  async function setStatus(order: AdminOrder, status: AdminOrderStatus) {
    setOrders(current => current?.map(o => o.id === order.id ? { ...o, status } : o) ?? current)
    setSelected(current => current && current.id === order.id ? { ...current, status } : current)
    try {
      await api.updateOrderStatus(order.id, status)
    } catch {
      load()
    }
  }

  async function setRider(order: AdminOrder, riderId: string | null) {
    const riderName = riderId ? riders.find(r => r.id === riderId)?.name ?? null : null
    setOrders(current => current?.map(o => o.id === order.id ? { ...o, riderId, riderName } : o) ?? current)
    setSelected(current => current && current.id === order.id ? { ...current, riderId, riderName } : current)
    try {
      await api.setOrderRider(order.id, riderId)
    } catch {
      load()
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!orders) return null

  // "التحصيل" الفعلي بيحصل وقت تسليم الطلب فقط، لأن الدفع كله عند الاستلام (COD) —
  // قبل التسليم الكاش لسه "قيد التحصيل"، والطلب الملغي كاشه ملغيش يتحصّل أصلاً.
  const collected = orders.filter(o => o.status === 'delivered')
  const pending = orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled')
  const cancelled = orders.filter(o => o.status === 'cancelled')

  const collectedTotal = collected.reduce((sum, o) => sum + o.total, 0)
  const pendingTotal = pending.reduce((sum, o) => sum + o.total, 0)

  const today = startOfDay(new Date()).getTime()
  const collectedToday = collected.filter(o => startOfDay(new Date(o.createdAt)).getTime() === today)
  const collectedTodayTotal = collectedToday.reduce((sum, o) => sum + o.total, 0)

  if (activeTab === 'overview') {
    return (
      <>
        <StatsGrid stats={[
          { label: 'إجمالي المحصّل', value: formatMoney(collectedTotal), note: `${collected.length} طلب تم تسليمه`, icon: '💰', tint: '#EAF8EF' },
          { label: 'قيد التحصيل', value: formatMoney(pendingTotal), note: `${pending.length} طلب لسه ما اتسلّمش`, icon: '⏳', tint: '#FFF3E3', noteColor: '#B45309' },
          { label: 'محصّل اليوم', value: formatMoney(collectedTodayTotal), note: `${collectedToday.length} طلب اتسلّم النهاردة`, icon: '📅', tint: '#EAF2FF' },
          { label: 'كاش ملغي', value: String(cancelled.length), note: 'طلبات ملغاة، مفيش كاش يتحصّل', icon: '🚫', tint: '#FFECEC', noteColor: '#B42318' }
        ]} />
        <WalletChart orders={collected} days={14} />
      </>
    )
  }

  if (activeTab === 'txns') {
    const filtered = orders.filter(o => {
      const q = query.trim()
      if (!q) return true
      return o.id.includes(q) || o.customer.fullName.includes(q) || o.customer.mobile.includes(q)
    })
    const filteredTotal = filtered.reduce((sum, o) => sum + o.total, 0)

    return (
      <>
        <StatsGrid stats={[
          { label: 'عدد الحركات', value: String(filtered.length), note: 'كل الطلبات، أياً كانت حالتها', icon: '🧾', tint: '#EAF2FF' },
          { label: 'إجمالي القيمة', value: formatMoney(filteredTotal), note: 'قبل استبعاد الملغي أو غير المحصّل', icon: '💰', tint: '#EAF8EF' }
        ]} />
        <OrderTable
          orders={filtered}
          onRowClick={setSelected}
          emptyNote="لا توجد حركات مالية بعد"
          footer="كل طلب = حركة مالية واحدة — اضغط عليه لعرض التفاصيل"
          toolbar={
            <div className="admin-search">
              <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث برقم الطلب أو اسم العميل أو الهاتف..." />
            </div>
          }
        />
        {selected && (
          <OrderDrawer
            order={selected}
            onClose={() => setSelected(null)}
            onSetStatus={status => setStatus(selected, status)}
            riders={riders}
            onSetRider={riderId => setRider(selected, riderId)}
          />
        )}
      </>
    )
  }

  if (activeTab === 'collect') {
    const filteredCollected = collected.filter(o => {
      const q = query.trim()
      if (!q) return true
      return o.id.includes(q) || o.customer.fullName.includes(q) || o.customer.mobile.includes(q)
    })

    return (
      <>
        <StatsGrid stats={[
          { label: 'عدد التحصيلات', value: String(filteredCollected.length), note: 'طلبات تم تسليمها وتحصيل قيمتها كاش', icon: '✅', tint: '#EAF8EF' },
          { label: 'إجمالي المحصّل', value: formatMoney(filteredCollected.reduce((sum, o) => sum + o.total, 0)), note: 'من نفس هذا العرض', icon: '💰', tint: '#EAF2FF' }
        ]} />
        <OrderTable
          orders={filteredCollected}
          onRowClick={setSelected}
          emptyNote="لا توجد تحصيلات بعد"
          footer="طلبات تم تسليمها فعلياً وتحصيل قيمتها نقداً عند الاستلام"
          toolbar={
            <div className="admin-search">
              <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث برقم الطلب أو اسم العميل أو الهاتف..." />
            </div>
          }
        />
        {selected && (
          <OrderDrawer
            order={selected}
            onClose={() => setSelected(null)}
            onSetStatus={status => setStatus(selected, status)}
            riders={riders}
            onSetRider={riderId => setRider(selected, riderId)}
          />
        )}
      </>
    )
  }

  if (activeTab === 'expenses') {
    return <ExpensesTab expenses={expenses} reload={loadExpenses} />
  }

  // activeTab === 'settle'
  return <SettlementsTab orders={orders} riders={riders} settlements={settlements} reloadRiders={loadRiders} reloadOrders={load} reloadSettlements={loadSettlements} />
}

function ExpensesTab({ expenses, reload }: { expenses: AdminExpense[], reload: () => void }) {
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayIso())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const total = expenses.reduce((sum, e) => sum + e.amount, 0)
  const thisMonth = expenses.filter(e => e.expenseDate.slice(0, 7) === todayIso().slice(0, 7))
  const thisMonthTotal = thisMonth.reduce((sum, e) => sum + e.amount, 0)

  async function add() {
    const amountNum = Number(amount)
    if (!category.trim() || !amountNum || amountNum <= 0 || !date) {
      setFormError('يرجى إدخال الفئة والمبلغ والتاريخ')
      return
    }
    setFormError('')
    setSaving(true)
    try {
      await api.createExpense({ category: category.trim(), amount: amountNum, note: note.trim(), expenseDate: date })
      setCategory(''); setAmount(''); setNote(''); setDate(todayIso())
      reload()
    } catch {
      setFormError('تعذر إضافة المصروف، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    try {
      await api.deleteExpense(id)
      reload()
    } catch {
      // ignore, list stays as-is
    }
  }

  return (
    <>
      <StatsGrid stats={[
        { label: 'إجمالي المصروفات', value: formatMoney(total), note: `${expenses.length} مصروف`, icon: '🧾', tint: '#FFECEC', noteColor: '#B42318' },
        { label: 'مصروفات هذا الشهر', value: formatMoney(thisMonthTotal), note: `${thisMonth.length} مصروف`, icon: '📅', tint: '#FFF3E3', noteColor: '#B45309' }
      ]} />

      <div className="admin-form-card" style={{ marginBottom: 16 }}>
        <div className="admin-form-card-title">إضافة مصروف</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <label>الفئة
            <input value={category} onChange={e => setCategory(e.target.value)} placeholder="مثال: بنزين، صيانة، إيجار" />
          </label>
          <label>المبلغ
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} />
          </label>
          <label>التاريخ
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </label>
          <label>ملاحظة (اختياري)
            <input value={note} onChange={e => setNote(e.target.value)} />
          </label>
        </div>
        {formError && <div className="admin-form-error">{formError}</div>}
        <button className="admin-form-save" disabled={saving} onClick={add}>إضافة المصروف</button>
      </div>

      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <div style={{ minWidth: 620 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: '1fr 1.6fr 1fr .9fr' }}>
              <div>التاريخ</div><div>الفئة / ملاحظة</div><div>المبلغ</div><div></div>
            </div>
            {expenses.map(e => (
              <div key={e.id} className="admin-table-row" style={{ gridTemplateColumns: '1fr 1.6fr 1fr .9fr' }}>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{e.expenseDate}</div>
                <div className="admin-cell-plain">
                  {e.category}
                  {e.note && <span style={{ color: '#8A948C', fontWeight: 500 }}> — {e.note}</span>}
                </div>
                <div className="admin-cell-plain" style={{ fontWeight: 800, color: '#B42318' }}>{formatMoney(e.amount)}</div>
                <div>
                  <button className="admin-form-chip" onClick={() => remove(e.id)}>حذف</button>
                </div>
              </div>
            ))}
            {expenses.length === 0 && <div className="admin-table-empty">لا توجد مصروفات مسجّلة بعد</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{expenses.length} مصروف</span>
          <span>سجل حر — لا توجد فئات ثابتة، اكتب أي فئة تناسب مصروفك</span>
        </div>
      </div>
    </>
  )
}

function SettlementsTab({
  orders, riders, settlements, reloadRiders, reloadOrders, reloadSettlements
}: {
  orders: AdminOrder[]
  riders: AdminRider[]
  settlements: AdminSettlement[]
  reloadRiders: () => void
  reloadOrders: () => void
  reloadSettlements: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [settlingId, setSettlingId] = useState<string | null>(null)

  const outstandingByRider = useMemo(() => {
    const map = new Map<string, { amount: number, count: number }>()
    for (const o of orders) {
      if (o.status !== 'delivered' || !o.riderId || o.settlementId) continue
      const current = map.get(o.riderId) ?? { amount: 0, count: 0 }
      current.amount += o.total
      current.count += 1
      map.set(o.riderId, current)
    }
    return map
  }, [orders])

  async function addRider() {
    if (!name.trim()) {
      setFormError('يرجى إدخال اسم المندوب')
      return
    }
    setFormError('')
    setSaving(true)
    try {
      await api.createRider({ name: name.trim(), phone: phone.trim() })
      setName(''); setPhone('')
      reloadRiders()
    } catch {
      setFormError('تعذر إضافة المندوب، حاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(rider: AdminRider) {
    try {
      await api.updateRider(rider.id, { active: !rider.active })
      reloadRiders()
    } catch {
      // ignore
    }
  }

  async function settle(riderId: string) {
    setSettlingId(riderId)
    try {
      await api.createSettlement(riderId)
      reloadOrders()
      reloadSettlements()
    } catch {
      // ignore — outstanding amount just stays as-is if it fails
    } finally {
      setSettlingId(null)
    }
  }

  const totalOutstanding = Array.from(outstandingByRider.values()).reduce((sum, v) => sum + v.amount, 0)

  return (
    <>
      <StatsGrid stats={[
        { label: 'إجمالي مستحق على المناديب', value: formatMoney(totalOutstanding), note: 'كاش لسه ما اتسلّمش للمتجر', icon: '⏳', tint: '#FFF3E3', noteColor: '#B45309' },
        { label: 'عدد المناديب النشطين', value: String(riders.filter(r => r.active).length), note: `من ${riders.length} إجمالاً`, icon: '🛵', tint: '#EAF2FF' }
      ]} />

      <div className="admin-form-card" style={{ marginBottom: 16 }}>
        <div className="admin-form-card-title">إضافة مندوب توصيل</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <label>الاسم
            <input value={name} onChange={e => setName(e.target.value)} placeholder="مثال: محمود أحمد" />
          </label>
          <label>الهاتف (اختياري)
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" />
          </label>
        </div>
        {formError && <div className="admin-form-error">{formError}</div>}
        <button className="admin-form-save" disabled={saving} onClick={addRider}>إضافة المندوب</button>
      </div>

      <div className="admin-table-card" style={{ marginBottom: 16 }}>
        <div className="admin-table-scroll">
          <div style={{ minWidth: 640 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: '1.4fr 1fr 1fr .9fr .9fr' }}>
              <div>المندوب</div><div>الهاتف</div><div>المستحق حالياً</div><div>الحالة</div><div></div>
            </div>
            {riders.map(r => {
              const outstanding = outstandingByRider.get(r.id)
              return (
                <div key={r.id} className="admin-table-row" style={{ gridTemplateColumns: '1.4fr 1fr 1fr .9fr .9fr' }}>
                  <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{r.name}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{r.phone || '—'}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800, color: outstanding ? '#B45309' : '#8A948C' }}>
                    {outstanding ? `${formatMoney(outstanding.amount)} (${outstanding.count} طلب)` : formatMoney(0)}
                  </div>
                  <div>
                    <button className={`admin-form-chip ${r.active ? 'active' : ''}`} onClick={() => toggleActive(r)}>
                      {r.active ? 'نشط' : 'متوقف'}
                    </button>
                  </div>
                  <div>
                    <button
                      className="admin-form-chip"
                      disabled={!outstanding || settlingId === r.id}
                      onClick={() => settle(r.id)}
                    >
                      تسوية
                    </button>
                  </div>
                </div>
              )
            })}
            {riders.length === 0 && <div className="admin-table-empty">لا يوجد مناديب مضافين بعد</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{riders.length} مندوب</span>
          <span>المستحق = طلبات تم تسليمها بواسطة المندوب ولسه ما اتسوّتش</span>
        </div>
      </div>

      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <div style={{ minWidth: 560 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: '1fr 1.3fr .8fr 1fr' }}>
              <div>التاريخ</div><div>المندوب</div><div>عدد الطلبات</div><div>المبلغ</div>
            </div>
            {settlements.map(s => (
              <div key={s.id} className="admin-table-row" style={{ gridTemplateColumns: '1fr 1.3fr .8fr 1fr' }}>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{new Date(s.createdAt).toLocaleString('ar-EG')}</div>
                <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{s.riderName}</div>
                <div className="admin-cell-plain">{s.orderCount}</div>
                <div className="admin-cell-plain" style={{ fontWeight: 800, color: '#12813C' }}>{formatMoney(s.amount)}</div>
              </div>
            ))}
            {settlements.length === 0 && <div className="admin-table-empty">لا توجد تسويات سابقة</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{settlements.length} تسوية</span>
          <span>سجل تاريخي — كل تسوية تقفل مستحقات المندوب وقت إنشائها</span>
        </div>
      </div>
    </>
  )
}
