import { AlertTriangle, CheckCircle2, Circle, ClipboardCheck, Clock3, LoaderCircle, Undo2 } from 'lucide-react'
import { formatTimestamp } from '../lib/incidents'
import { elapsedUnresolvedMinutes } from '../services/escalation'
import type { ChecklistState } from '../services/escalation'
import { PLAYBOOK_DISCLAIMER, findAction } from '../services/playbooks'
import type { ActionEvent, Incident } from '../types'

function duration(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
}

export function ResponseChecklist({ incident, checklist, now, loading, loadError, actionError, pending, onToggle }: {
  incident: Incident
  checklist: ChecklistState
  now: number
  loading: boolean
  loadError: string
  actionError: string
  pending: ReadonlySet<string>
  onToggle: (actionId: string, completed: boolean) => void
}) {
  const elapsed = elapsedUnresolvedMinutes(incident, now)
  const percent = checklist.totalCount ? (checklist.completedCount / checklist.totalCount) * 100 : 0

  return (
    <section aria-label="Response checklist" className="mt-5 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow flex items-center gap-1.5"><ClipboardCheck size={13} aria-hidden />Response checklist</p>
          <p className="mt-1 text-sm text-slate-700">
            {elapsed === null ? (incident.status === 'RESOLVED' ? 'Incident resolved.' : 'Elapsed time unavailable.') : <span className="inline-flex items-center gap-1"><Clock3 size={14} aria-hidden />Unresolved for {duration(elapsed)}</span>}
          </p>
        </div>
        {checklist.overdueCount > 0 && (
          <span role="status" className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800"><AlertTriangle size={13} aria-hidden />Response target exceeded ({checklist.overdueCount})</span>
        )}
      </div>

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted"><LoaderCircle className="animate-spin" size={16} />Loading response checklist…</p>
      ) : loadError ? (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{loadError}</p>
      ) : checklist.totalCount === 0 ? (
        <p className="mt-4 text-sm text-muted">No response actions are defined for this severity.</p>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={checklist.totalCount} aria-valuenow={checklist.completedCount} aria-label="Checklist progress"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} /></div>
            <span className="text-xs font-semibold tabular-nums text-slate-700">{checklist.completedCount} / {checklist.totalCount} done</span>
          </div>

          {actionError && <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{actionError}</p>}

          <ul className="mt-3 space-y-2">
            {checklist.items.map((item) => {
              const busy = pending.has(item.action.id)
              const id = `action-${item.action.id}`
              return (
                <li key={item.action.id} className={`rounded-lg border px-3 py-2.5 ${item.overdue ? 'border-red-300 bg-red-50/60' : item.completed ? 'border-green-200 bg-green-50/50' : 'border-line bg-white'}`}>
                  <div className="flex items-start gap-3">
                    <input id={id} type="checkbox" checked={item.completed} disabled={busy} onChange={(e) => onToggle(item.action.id, e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-brand-600" />
                    <div className="min-w-0 flex-1">
                      <label htmlFor={id} className={`block cursor-pointer text-sm font-medium ${item.completed ? 'text-slate-600' : 'text-ink'}`}>{item.action.title}</label>
                      <p className="text-xs text-muted">{item.action.description}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {item.completed ? (
                          <span className="inline-flex items-center gap-1 text-green-800"><CheckCircle2 size={13} aria-hidden />Done by {item.completedBy} · {formatTimestamp(item.completedAt!)}{item.completedLate && <span className="font-semibold text-amber-800"> (after target)</span>}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-600"><Circle size={13} aria-hidden />Not done</span>
                        )}
                        {item.overdue && <span className="inline-flex items-center gap-1 font-semibold text-red-800"><AlertTriangle size={13} aria-hidden />Response target exceeded by {duration(item.overdueByMinutes!)}</span>}
                        {!item.overdue && !item.completed && item.dueAt && incident.status !== 'RESOLVED' && <span className="text-muted">Target: by {formatTimestamp(item.dueAt)}</span>}
                      </div>
                    </div>
                    {busy && <LoaderCircle className="mt-1 animate-spin text-muted" size={15} aria-label="Saving" />}
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="mt-4 border-t border-line pt-3">
            <p className="eyebrow mb-2">Action history</p>
            {checklist.history.length === 0 ? (
              <p className="text-xs text-muted">No actions recorded yet.</p>
            ) : (
              <ol className="space-y-1.5">
                {checklist.history.map((event: ActionEvent) => (
                  <li key={event.id} className="flex items-start gap-2 text-xs text-slate-600">
                    {event.type === 'COMPLETED' ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-green-700" aria-hidden /> : <Undo2 size={13} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />}
                    <span><strong className="font-semibold text-slate-700">{event.type === 'COMPLETED' ? 'Completed' : 'Undone'}</strong> “{findAction(event.actionId)?.title ?? event.actionId}” · {event.actor} · {formatTimestamp(event.at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
      <p className="mt-3 text-[11px] leading-4 text-muted">{PLAYBOOK_DISCLAIMER} Staff names are demo labels and are not verified. Completing every action does not resolve the incident.</p>
    </section>
  )
}
