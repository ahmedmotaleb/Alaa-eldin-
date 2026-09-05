const items = [
  ['📦', 'الطلبات'],
  ['📍', 'العناوين المحفوظة'],
  ['☎', 'تواصل معنا'],
  ['ⓘ', 'عن المتجر'],
  ['↺', 'سياسة الاستبدال والاسترجاع']
]

export function AccountPage() {
  return (
    <section>
      <div className="page-title">
        <h1>حسابي</h1>
        <p>إدارة بياناتك ومعلومات المتجر.</p>
      </div>
      <div className="account-list">
        {items.map(([icon, label]) => (
          <button key={label}><span>{icon}</span><strong>{label}</strong><span>‹</span></button>
        ))}
      </div>
    </section>
  )
}
