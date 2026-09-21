import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NAV } from '../nav'
import { useAuth } from '../store/AuthContext'
import { useDebouncedValue } from '../utils/useDebouncedValue'
import { api, ApiError, type GlobalSearchResultItem } from '../utils/api'
import { formatMoney } from '../utils/money'
import { formatDate } from '../utils/format'
import { ORDER_STATUS_LABEL } from '../orderStatus'
import { TICKET_STATUS_LABEL, type TicketStatus } from '../supportTicket'

interface NavCommand {
  kind: 'command'
  key: string
  label: string
  path: string
}

// أوامر التنقل السريع — نفس بيانات الشريط الجانبي بالظبط (NAV) عشان محدش يقدر يوصل من
// هنا لصفحة مش موجودة أصلاً في الشريط، وأي إضافة/تعديل مستقبلي في nav.ts بينعكس هنا
// تلقائياً من غير أي تكرار. المسارات "adminOnly" بتتفلتر بنفس منطق Sidebar بالظبط.
function buildNavCommands(isFullAdmin: boolean): NavCommand[] {
  const commands: NavCommand[] = []
  for (const group of NAV) {
    if (group.children.length === 0) {
      commands.push({ kind: 'command', key: group.id, label: group.label, path: group.id === 'home' ? '/' : `/${group.id}` })
      continue
    }
    for (const child of group.children) {
      if (child.adminOnly && !isFullAdmin) continue
      commands.push({ kind: 'command', key: `${group.id}-${child.id}`, label: `${group.label} · ${child.label}`, path: `/${group.id}/${child.id}` })
    }
  }
  commands.push({ kind: 'command', key: 'notifications', label: 'التنبيهات', path: '/notifications' })
  return commands
}

const GROUP_LABEL: Record<GlobalSearchResultItem['type'], string> = {
  products: 'المنتجات',
  orders: 'الطلبات',
  customers: 'العملاء',
  suppliers: 'الموردين',
  purchase_orders: 'أوامر الشراء',
  support_tickets: 'تذاكر الدعم'
}

const GROUP_ORDER: GlobalSearchResultItem['type'][] =
  ['products', 'orders', 'customers', 'suppliers', 'purchase_orders', 'support_tickets']

function resultSubtitle(item: GlobalSearchResultItem): string {
  switch (item.type) {
    case 'products': return `${item.categoryName} · ${formatMoney(item.price)} · مخزون: ${item.stock}`
    case 'orders': return `${item.customerFullName} · ${(ORDER_STATUS_LABEL as Record<string, string>)[item.status] ?? item.status} · ${formatMoney(item.total)}`
    case 'customers': return [item.email, item.mobile].filter(Boolean).join(' · ')
    case 'suppliers': return item.mobile || 'بدون رقم موبايل'
    case 'purchase_orders': return `${item.supplierName} · ${item.status} · ${formatMoney(item.total)}`
    case 'support_tickets': return [
      item.customerFullName,
      TICKET_STATUS_LABEL[item.status as TicketStatus] ?? item.status,
      item.relatedOrderNumber
    ].filter(Boolean).join(' · ')
  }
}

function resultTitle(item: GlobalSearchResultItem): string {
  switch (item.type) {
    case 'products': return item.name
    case 'orders': return item.orderNumber
    case 'customers': return item.fullName
    case 'suppliers': return item.name
    case 'purchase_orders': return item.poNumber
    case 'support_tickets': return item.ticketNumber
  }
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GlobalSearchResultItem[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debouncedQuery = useDebouncedValue(query, 250)

  const navCommands = useMemo(() => buildNavCommands(user?.role === 'admin'), [user?.role])

  const filteredCommands = useMemo(() => {
    const q = query.trim()
    if (!q) return navCommands.slice(0, 8)
    return navCommands.filter(c => c.label.includes(q))
  }, [navCommands, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setActiveIndex(0)
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(focusTimer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const term = debouncedQuery.trim()
    if (term.length < 2) { setResults([]); return }
    let cancelled = false
    setLoading(true)
    api.globalSearch(term)
      .then(({ results }) => {
        if (cancelled) return
        const flat = GROUP_ORDER.flatMap(type => results[type] ?? [])
        setResults(flat)
      })
      .catch(err => { if (!cancelled && !(err instanceof ApiError && err.status === 429)) setResults([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debouncedQuery, open])

  useEffect(() => { setActiveIndex(0) }, [filteredCommands, results])

  const flatItems = useMemo(
    () => [...filteredCommands.map(c => ({ type: 'command' as const, item: c })), ...results.map(r => ({ type: 'result' as const, item: r }))],
    [filteredCommands, results]
  )

  function go(path: string) {
    onClose()
    navigate(path)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, flatItems.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const active = flatItems[activeIndex]
      if (!active) return
      go(active.type === 'command' ? active.item.path : active.item.url)
    }
  }

  if (!open) return null

  let runningIndex = -1

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="البحث الشامل" onClick={e => e.stopPropagation()}>
        <div className="command-palette-input-row">
          <span className="command-palette-icon" aria-hidden="true">🔎</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="ابحث في النظام..."
            aria-label="ابحث في النظام"
            autoComplete="off"
          />
          <button type="button" className="command-palette-close" onClick={onClose} aria-label="إغلاق">✕</button>
        </div>

        <div className="command-palette-results" role="listbox">
          {query.trim().length >= 2 && loading && <div className="command-palette-hint">جارِ البحث...</div>}
          {query.trim().length === 1 && <div className="command-palette-hint">اكتب حرفين على الأقل للبحث في النظام</div>}

          {filteredCommands.length > 0 && (
            <div className="command-palette-group">
              <div className="command-palette-group-label">أوامر سريعة</div>
              {filteredCommands.map(cmd => {
                runningIndex++
                const index = runningIndex
                return (
                  <button
                    key={cmd.key}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`command-palette-row ${index === activeIndex ? 'active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => go(cmd.path)}
                  >
                    <span className="command-palette-row-icon" aria-hidden="true">↗️</span>
                    <span className="command-palette-row-title">{cmd.label}</span>
                  </button>
                )
              })}
            </div>
          )}

          {GROUP_ORDER.map(type => {
            const items = results.filter(r => r.type === type)
            if (items.length === 0) return null
            return (
              <div className="command-palette-group" key={type}>
                <div className="command-palette-group-label">{GROUP_LABEL[type]}</div>
                {items.map(item => {
                  runningIndex++
                  const index = runningIndex
                  return (
                    <button
                      key={`${item.type}-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={`command-palette-row ${index === activeIndex ? 'active' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => go(item.url)}
                    >
                      <div className="command-palette-row-text">
                        <span className="command-palette-row-title">{resultTitle(item)}</span>
                        <span className="command-palette-row-subtitle">{resultSubtitle(item)}</span>
                      </div>
                      {'createdAt' in item && <span className="command-palette-row-date">{formatDate(item.createdAt)}</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}

          {query.trim().length >= 2 && !loading && results.length === 0 && (
            <div className="command-palette-hint">لا توجد نتائج مطابقة</div>
          )}
        </div>
      </div>
    </div>
  )
}
