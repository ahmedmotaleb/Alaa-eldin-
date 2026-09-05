import type { ReactNode } from 'react'

export function Section({ title, children }: { title: string, children: ReactNode }) {
  return (
    <section className="home-section">
      <div className="section-heading"><h2>{title}</h2></div>
      {children}
    </section>
  )
}
