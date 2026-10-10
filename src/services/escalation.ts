/**
 * Derived response-checklist state and escalation indicators. Pure: everything is computed from the incident, its
 * events and a reference time, so "overdue" is never stored and cannot go stale. Indicators only update while
 * the page is open; there are no background alerts or notifications.
 */
import type { ActionEvent, Incident } from '../types'
import { sortEvents } from './actionTracking'
import { defaultPlaybookConfig, getPlaybook } from './playbooks'
import type { PlaybookAction, PlaybookConfig } from './playbooks'
import { parseTime } from './riskScoring'
import type { TimeInput } from './riskScoring'

export interface ChecklistItem {
  action: PlaybookAction
  completed: boolean
  completedAt?: string
  completedBy?: string
  /** ISO time the response target falls due (created time + target), when computable. */
  dueAt?: string
  /** Unresolved incident, action not completed and the target time has passed. */
  overdue: boolean
  overdueByMinutes?: number
  /** Completed, but after the target time. */
  completedLate: boolean
}

export interface ChecklistState {
  items: ChecklistItem[]
  completedCount: number
  totalCount: number
  overdueCount: number
  /** Chronological event log for this incident (oldest first). */
  history: ActionEvent[]
}

/** Whole minutes an incident has been unresolved, or null for resolved reports or unusable timestamps. */
export function elapsedUnresolvedMinutes(incident: Pick<Incident, 'status' | 'createdAt'>, now: TimeInput): number | null {
  if (incident.status === 'RESOLVED') return null
  const created = parseTime(incident.createdAt)
  const nowMs = parseTime(now)
  if (created === null || nowMs === null) return null
  return Math.max(0, Math.floor((nowMs - created) / 60000))
}

export function deriveChecklist(incident: Incident, events: readonly ActionEvent[], now: TimeInput, config: PlaybookConfig = defaultPlaybookConfig): ChecklistState {
  const created = parseTime(incident.createdAt)
  const nowMs = parseTime(now)
  const mine = events.filter((event) => event.incidentId === incident.id)
  const unresolved = incident.status !== 'RESOLVED'

  const items = getPlaybook(incident.severity, config).map((action): ChecklistItem => {
    const log = sortEvents(mine.filter((event) => event.actionId === action.id))
    const last = log[log.length - 1]
    const completed = last?.type === 'COMPLETED'
    const dueMs = created !== null && action.responseTargetMinutes !== undefined ? created + action.responseTargetMinutes * 60000 : null
    const completedMs = completed ? parseTime(last.at) : null
    const overdue = unresolved && !completed && dueMs !== null && nowMs !== null && nowMs > dueMs
    return {
      action,
      completed,
      completedAt: completed ? last.at : undefined,
      completedBy: completed ? last.actor : undefined,
      dueAt: dueMs !== null ? new Date(dueMs).toISOString() : undefined,
      overdue,
      overdueByMinutes: overdue ? Math.max(1, Math.floor((nowMs! - dueMs!) / 60000)) : undefined,
      completedLate: completedMs !== null && dueMs !== null && completedMs > dueMs,
    }
  })

  return {
    items,
    completedCount: items.filter((item) => item.completed).length,
    totalCount: items.length,
    overdueCount: items.filter((item) => item.overdue).length,
    history: [...mine].sort((a, b) => (parseTime(a.at) ?? 0) - (parseTime(b.at) ?? 0) || a.seq - b.seq || a.id.localeCompare(b.id)),
  }
}
