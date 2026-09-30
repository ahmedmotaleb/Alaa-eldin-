import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { useAddresses } from '../store/AddressContext'
import { useCatalog } from '../store/CatalogContext'
import type { ApiAddress } from '../utils/api'
import { ar } from '../i18n/ar'

// شيت اختيار عنوان التوصيل — بيفتح من هيدر الرئيسية. بيستخدم نفس مصدر العناوين الوحيد
// (AddressContext) اللي صفحة "عناويني المحفوظة" بتستخدمه، فأي اختيار هنا بيحدّث العنوان
// الافتراضي فوراً في كل مكان، من غير أي حالة/API منفصلة. الزائر (بدون تسجيل دخول) بيشوف
// دعوة لتسجيل الدخول بس، من غير ما يتمنع من الاستمرار في التصفح (تقفيل الشيت بيرجّعه للتصفح
// العادي زي ما هو).
export function AddressSheet({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const { addresses, loading, setDefault } = useAddresses()
  const { deliveryZones } = useCatalog()
  const navigate = useNavigate()
  const sheetRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<Element | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement
    sheetRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus()
    }
  }, [onClose])

  async function pick(address: ApiAddress) {
    if (!address.isDefault) await setDefault(address.id)
    onClose()
  }

  function goToAddresses() {
    onClose()
    navigate('/account/addresses')
  }

  return (
    <div className="address-sheet-backdrop" onClick={onClose}>
      <div
        className="address-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={ar.addressSheet.title}
        tabIndex={-1}
        ref={sheetRef}
        onClick={e => e.stopPropagation()}
      >
        <div className="unit-sheet-handle" />
        <button type="button" className="unit-sheet-close" onClick={onClose} aria-label={ar.common.close}>✕</button>
        <strong className="address-sheet-title">{ar.addressSheet.title}</strong>

        {!user ? (
          <div className="address-sheet-guest">
            <p>{ar.addressSheet.guestNote}</p>
            <button
              className="primary-button"
              onClick={() => { onClose(); navigate('/login') }}
            >
              {ar.addressSheet.guestLoginCta}
            </button>
          </div>
        ) : loading ? (
          <div className="unit-sheet-loading">{ar.common.loading}</div>
        ) : addresses.length === 0 ? (
          <div className="address-sheet-empty">
            <p>{ar.addressSheet.emptyTitle}</p>
            <button className="primary-button" onClick={goToAddresses}>{ar.addressSheet.emptyCta}</button>
          </div>
        ) : (
          <>
            <div className="address-sheet-list">
              {addresses.map(a => {
                const outsideZone = !deliveryZones.some(z => z.governorate === a.governorate)
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`address-sheet-option ${a.isDefault ? 'active' : ''}`}
                    onClick={() => pick(a)}
                  >
                    <span className="address-sheet-option-label">
                      {a.label || a.governorate}
                      {a.isDefault && <span className="address-default-badge">{ar.addressSheet.defaultBadge}</span>}
                    </span>
                    <span className="address-sheet-option-preview">{a.area ? `${a.area}، ${a.governorate}` : a.governorate}</span>
                    {outsideZone && <span className="address-zone-warning">{ar.addresses.outsideZoneWarning}</span>}
                  </button>
                )
              })}
            </div>
            <button className="secondary-button" onClick={goToAddresses}>{ar.addressSheet.addNew}</button>
          </>
        )}
      </div>
    </div>
  )
}
