export function StickyActionBar({
  label,
  meta,
  onClick,
  disabled = false,
  muted = false
}: {
  label: string
  meta?: string
  onClick: () => void
  disabled?: boolean
  muted?: boolean
}) {
  return (
    <div className="sticky-action-bar">
      <button className={muted ? 'muted' : ''} onClick={onClick} disabled={disabled}>
        <span>{label}</span>
        {meta && <span className="sticky-action-meta">{meta}</span>}
      </button>
    </div>
  )
}
