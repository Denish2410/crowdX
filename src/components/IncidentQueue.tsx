import { ArrowRight, CheckCircle2, ChevronRight, Clock3, Inbox, MapPin } from 'lucide-react'
import { resolveStation } from '../data/stations'
import { actionLabel, formatTimestamp, nextStatus, relativeTime, severityTone } from '../lib/incidents'
import type { RiskResult } from '../services/riskScoring'
import { riskBandLabel } from '../services/riskScoring'
import type { Incident } from '../types'
import { CorridorBadges, EmptyState, RiskBadge, RiskBadgeFor, riskTone, SeverityBadge, StatusBadge } from './ui'

export function IncidentList({ incidents, risks, selectedId, onSelect, onAdvance, emptyTitle, emptyHint }: {
  incidents: Incident[]
  risks: ReadonlyMap<string, RiskResult>
  selectedId?: string
  onSelect: (id: string) => void
  onAdvance: (incident: Incident) => void
  emptyTitle: string
  emptyHint: string
}) {
  if (incidents.length === 0) return <EmptyState icon={<Inbox size={20} />} title={emptyTitle}>{emptyHint}</EmptyState>
  return (
    <ul className="divide-y divide-line">
      {incidents.map((incident) => (
        <IncidentRow key={incident.id} incident={incident} risk={risks.get(incident.id)} selected={incident.id === selectedId} onSelect={() => onSelect(incident.id)} onAdvance={() => onAdvance(incident)} />
      ))}
    </ul>
  )
}

function IncidentRow({ incident, risk, selected, onSelect, onAdvance }: { incident: Incident; risk?: RiskResult; selected: boolean; onSelect: () => void; onAdvance: () => void }) {
  const station = resolveStation(incident)
  const action = actionLabel[incident.status]
  const resolved = incident.status === 'RESOLVED'
  return (
    <li className={`relative flex items-stretch transition-colors ${selected ? 'bg-tint' : resolved ? 'bg-slate-50/70 hover:bg-slate-50' : 'hover:bg-slate-50'}`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${resolved ? 'bg-slate-200' : severityTone[incident.severity].dot}`} aria-hidden />
      <button type="button" onClick={onSelect} aria-current={selected} className="flex min-w-0 flex-1 items-center gap-3 py-4 pl-6 pr-3 text-left sm:pl-7">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`font-semibold ${resolved ? 'text-slate-500' : 'text-ink'}`}>{station?.name ?? incident.station}</span>
            <span className="text-sm text-muted">· {incident.zone}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{incident.notes}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RiskBadgeFor risk={risk} />
            <SeverityBadge severity={incident.severity} />
            <StatusBadge status={incident.status} />
            <span className="inline-flex items-center gap-1 text-xs text-muted"><Clock3 size={12} />{relativeTime(incident.createdAt)}</span>
          </div>
        </div>
        <ChevronRight className="hidden shrink-0 text-slate-400 sm:block" size={18} aria-hidden />
      </button>
      {action && (
        <div className="flex items-center pr-4 sm:pr-5">
          <button type="button" onClick={onAdvance} className="btn-ghost whitespace-nowrap" aria-label={`${action} report at ${station?.name ?? incident.station}`}>{action}</button>
        </div>
      )}
    </li>
  )
}

export function IncidentDetails({ incident, risk, onAdvance }: { incident: Incident; risk?: RiskResult; onAdvance: () => void }) {
  const station = resolveStation(incident)
  const action = actionLabel[incident.status]
  return (
    <article className="card p-5 sm:p-6" aria-label="Selected report">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="eyebrow">Selected report</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-ink">{station?.name ?? incident.station} <span className="font-normal text-muted">· {incident.zone}</span></h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {station && <CorridorBadges corridors={station.connectedCorridors} />}
            {station?.isInterchange && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Interchange</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2"><SeverityBadge severity={incident.severity} /><StatusBadge status={incident.status} /></div>
      </div>

      {risk && <RiskPanel risk={risk} />}

      <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_13rem]">
        <div>
          <p className="text-sm leading-6 text-slate-700">{incident.notes}</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1"><MapPin size={13} />Ahmedabad Metro Phase II</span>
            <span className="inline-flex items-center gap-1"><Clock3 size={13} />Reported {formatTimestamp(incident.createdAt)}</span>
          </div>
          {action && nextStatus[incident.status] && (
            <button type="button" onClick={onAdvance} className="btn-primary mt-5">{action} report<ArrowRight size={16} /></button>
          )}
          {!action && <p className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-green-700"><CheckCircle2 size={16} />Resolved. No further action needed.</p>}
        </div>
        <div className="md:border-l md:border-line md:pl-5">
          <p className="eyebrow mb-3">Status history</p>
          <ol className="space-y-3">
            {incident.history.map((event, index) => (
              <li key={`${event.status}-${event.at}`} className="flex gap-2.5 text-xs text-muted">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${index === incident.history.length - 1 ? 'bg-brand-600 ring-4 ring-brand-600/15' : 'bg-slate-300'}`} />
                <span><strong className="block text-sm font-semibold text-slate-700">{event.status.charAt(0) + event.status.slice(1).toLowerCase()}</strong>{formatTimestamp(event.at)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </article>
  )
}

const factorRows = [
  ['severity', 'Reported severity'],
  ['duration', 'Unresolved duration'],
  ['recurrence', 'Repeat reports at this station'],
] as const

function RiskPanel({ risk }: { risk: RiskResult }) {
  const { factors } = risk
  const changes = [factors.duration.nextChange, factors.recurrence.nextChange].filter((text): text is string => Boolean(text))
  return (
    <section aria-label="Calculated risk" className="mt-5 rounded-xl border border-line bg-slate-50/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Calculated risk</p>
          <p className="mt-1 flex items-baseline gap-2"><span className={`text-3xl font-bold tabular-nums ${riskTone[risk.riskBand].text}`}>{risk.score}</span><span className="text-sm text-muted">/ 100</span></p>
        </div>
        <div className="text-right">
          <RiskBadge band={risk.riskBand} />
          <p className="mt-1.5 text-xs text-muted">{risk.eligibleForActive ? 'Ranked as an active incident' : 'Resolved: historical score only, not ranked as active'}</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">Staff-reported severity and calculated risk are separate. Severity is what staff reported; risk is a heuristic from severity, time unresolved and repeat reports. Neither changes the other.</p>

      <ul className="mt-4 space-y-3" aria-label="Score breakdown">
        {factorRows.map(([key, label]) => {
          const factor = factors[key]
          return (
            <li key={key}>
              <div className="flex items-baseline justify-between gap-3 text-sm"><span className="font-medium text-slate-700">{label}</span><span className="tabular-nums text-slate-700">{factor.points} <span className="text-muted">/ {factor.max}</span></span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200" role="presentation"><div className={`h-full rounded-full ${riskTone[risk.riskBand].bar}`} style={{ width: `${factor.max ? (factor.points / factor.max) * 100 : 0}%` }} /></div>
              <p className="mt-1 text-xs text-muted">{factor.detail}</p>
            </li>
          )
        })}
      </ul>

      <div className="mt-4 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
        <div>
          <p className="eyebrow mb-2">Why this score</p>
          <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-slate-600">{risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
        <div>
          <p className="eyebrow mb-2">How it can change</p>
          {risk.eligibleForActive && changes.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-slate-600">{changes.map((text) => <li key={text}>{text}</li>)}</ul>
          ) : (
            <p className="text-xs leading-5 text-slate-600">{risk.eligibleForActive ? 'Both time-based factors are at their maximum or have no further steps.' : 'Resolved reports do not accrue age or recurrence points.'}</p>
          )}
          {risk.eligibleForActive && <p className="mt-2 text-xs leading-5 text-slate-600">Acknowledging does not stop the clock; only resolving removes a report from active risk.</p>}
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted">Band: {riskBandLabel[risk.riskBand]}. Demo heuristic, not an official safety threshold. Calculated at {risk.referenceTime ? new Date(risk.referenceTime).toLocaleTimeString('en-IN', { timeStyle: 'short' }) : 'unknown time'}.</p>
    </section>
  )
}
