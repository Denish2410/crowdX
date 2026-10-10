import { AlertTriangle, Gauge, OctagonAlert, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { corridorById } from '../data/stations'
import type { CorridorId } from '../data/stations'
import { severityLabel, severityTone, statusLabel, statusTone } from '../lib/incidents'
import { riskBandLabel } from '../services/riskScoring'
import type { RiskBand, RiskResult } from '../services/riskScoring'
import type { IncidentStatus, Severity } from '../types'

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${severityTone[severity].badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${severityTone[severity].dot}`} aria-hidden />
      <span className="font-normal opacity-80">Severity</span> {severityLabel[severity]}
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

export const riskTone: Record<RiskBand, { badge: string; bar: string; text: string }> = {
  LOW: { badge: 'border-green-200 bg-green-50 text-green-800', bar: 'bg-green-500', text: 'text-green-700' },
  MODERATE: { badge: 'border-amber-200 bg-amber-50 text-amber-900', bar: 'bg-amber-500', text: 'text-amber-800' },
  HIGH: { badge: 'border-orange-300 bg-orange-50 text-orange-800', bar: 'bg-orange-500', text: 'text-orange-700' },
  CRITICAL: { badge: 'border-red-300 bg-red-50 text-red-800', bar: 'bg-red-600', text: 'text-red-700' },
}

export const riskIcon: Record<RiskBand, typeof Gauge> = { LOW: ShieldCheck, MODERATE: Gauge, HIGH: AlertTriangle, CRITICAL: OctagonAlert }

/** Calculated risk: always an icon, a text label and the number, never colour alone. */
export function RiskBadge({ band, score }: { band: RiskBand; score?: number }) {
  const Icon = riskIcon[band]
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${riskTone[band].badge}`} title="Calculated risk (heuristic decision support)">
      <Icon size={12} aria-hidden />
      <span>Risk {riskBandLabel[band]}</span>
      {score !== undefined && <span className="tabular-nums opacity-80">· {score}</span>}
    </span>
  )
}

export function RiskBadgeFor({ risk }: { risk?: RiskResult }) {
  return risk && risk.eligibleForActive ? <RiskBadge band={risk.riskBand} score={risk.score} /> : null
}
