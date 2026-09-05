export function QuantityCounter({
  value,
  onChange
}: {
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="quantity-counter" aria-label="اختيار الكمية">
      <button onClick={() => onChange(value + 1)} aria-label="زيادة الكمية">+</button>
      <span>{value}</span>
      <button onClick={() => onChange(value - 1)} aria-label="تقليل الكمية">−</button>
    </div>
  )
}
