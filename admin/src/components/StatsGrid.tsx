export interface Stat {
  label: string
  value: string
  note: string
  icon: string
  tint: string
  noteColor?: string
}

export function StatsGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className="admin-stats">
      {stats.map(stat => (
        <div className="admin-stat-card" key={stat.label}>
          <div className="admin-stat-head">
            <span className="admin-stat-label">{stat.label}</span>
            <span className="admin-stat-icon" style={{ background: stat.tint }}>{stat.icon}</span>
          </div>
          <div className="admin-stat-value">{stat.value}</div>
          <div className="admin-stat-note" style={{ color: stat.noteColor ?? '#12813C' }}>{stat.note}</div>
        </div>
      ))}
    </div>
  )
}
