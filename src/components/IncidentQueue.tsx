import { ArrowRight, CheckCircle2, ChevronRight, Clock3, Inbox, MapPin } from 'lucide-react'
import { resolveStation } from '../data/stations'
import { actionLabel, formatTimestamp, nextStatus, relativeTime, severityTone } from '../lib/incidents'
import type { Incident } from '../types'
import { CorridorBadges, EmptyState, SeverityBadge, StatusBadge } from './ui'

export function IncidentList({ incidents, selectedId, onSelect, onAdvance, emptyTitle, emptyHint }: {
  incidents: Incident[]
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
        <IncidentRow key={incident.id} incident={incident} selected={incident.id === selectedId} onSelect={() => onSelect(incident.id)} onAdvance={() => onAdvance(incident)} />
      ))}
    </ul>
  )
}

function IncidentRow({ incident, selected, onSelect, onAdvance }: { incident: Incident; selected: boolean; onSelect: () => void; onAdvance: () => void }) {
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

export function IncidentDetails({ incident, onAdvance }: { incident: Incident; onAdvance: () => void }) {
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
        <div className="flex gap-2"><SeverityBadge severity={incident.severity} /><StatusBadge status={incident.status} /></div>
      </div>

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
