import type { ReactNode } from 'react'
import { corridorById } from '../data/stations'
import type { CorridorId } from '../data/stations'
import { severityLabel, severityTone, statusLabel, statusTone } from '../lib/incidents'
import type { IncidentStatus, Severity } from '../types'

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${severityTone[severity].badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${severityTone[severity].dot}`} aria-hidden />
      {severityLabel[severity]}
    </span>
  )
}

export function StatusBadge({ status }: { status: IncidentStatus }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusTone[status]}`}>{statusLabel[status]}</span>
}

export function CorridorBadges({ corridors }: { corridors: CorridorId[] }) {
  return (
    <>
      {corridors.map((id) => (
        <span key={id} className="rounded-md bg-tint px-1.5 py-0.5 text-[11px] font-medium text-brand-700">
          {corridorById(id).shortName}
        </span>
      ))}
    </>
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-tint text-brand-600">{icon}</div>
      <p className="font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
    </div>
  )
}
