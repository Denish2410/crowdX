import { Gauge } from 'lucide-react'
import { riskBandLabel } from '../services/riskScoring'
import type { RiskBand } from '../services/riskScoring'
import type { RiskOverview } from '../services/riskSummary'
import { resolveStation } from '../data/stations'
import { relativeTime } from '../lib/incidents'
import { EmptyState, riskIcon, riskTone, RiskBadge } from './ui'

const bandsShown: RiskBand[] = ['CRITICAL', 'HIGH', 'MODERATE']

export function RiskOverviewCard({ overview, onOpen }: { overview: RiskOverview; onOpen: (id: string) => void }) {
  return (
    <section className="card" aria-label="Risk overview">
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <h2 className="font-semibold text-ink">Calculated risk overview</h2>
        <p className="mt-0.5 text-xs text-muted">Heuristic from severity, time unresolved and repeat reports. Decision support only, not a validated prediction.</p>
      </div>
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
        {bandsShown.map((band) => {
          const Icon = riskIcon[band]
          return (
            <div key={band} className="px-3 py-4 text-center sm:px-5">
              <Icon size={18} className={`mx-auto ${riskTone[band].text}`} aria-hidden />
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-ink">{overview.counts[band]}</p>
              <p className="text-xs text-muted">{riskBandLabel[band]} risk</p>
            </div>
          )
        })}
      </div>
      {overview.top.length === 0 ? (
        <EmptyState icon={<Gauge size={20} />} title="No active risk">There are no unresolved reports to rank.</EmptyState>
      ) : (
        <ol className="divide-y divide-line">
          {overview.top.map(({ incident, risk }, index) => (
            <li key={incident.id}>
              <button type="button" onClick={() => onOpen(incident.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50 sm:px-6">
                <span className="w-4 text-sm font-bold text-muted">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{resolveStation(incident)?.name ?? incident.station} <span className="font-normal text-muted">· {incident.zone}</span></span>
                  <span className="text-xs text-muted">Reported {incident.severity.toLowerCase()} · {relativeTime(incident.createdAt)}</span>
                </span>
                <RiskBadge band={risk.riskBand} score={risk.score} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
