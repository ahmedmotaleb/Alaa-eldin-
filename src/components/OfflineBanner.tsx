import { useEffect, useRef } from 'react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useToast } from '../store/ToastContext'
import { ar } from '../i18n/ar'

export function OfflineBanner() {
  const isOnline = useOnlineStatus()
  const flash = useToast()
  const wasOffline = useRef(false)

  useEffect(() => {
    if (isOnline && wasOffline.current) flash(ar.network.backOnline)
    wasOffline.current = !isOnline
  }, [isOnline, flash])

  if (isOnline) return null

  return (
    <div className="offline-banner" role="status">
      <span>{ar.network.offline}</span>
      <span className="offline-banner-note">{ar.network.offlineNote}</span>
      <button onClick={() => window.location.reload()}>{ar.network.retry}</button>
    </div>
  )
}
