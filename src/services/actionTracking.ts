/** Persistence for response-checklist events. Append-only; completion state is derived from the log. */
import type { CrowdXDb } from '../lib/crowdxDb'
import type { ActionEvent, ActionEventType } from '../types'
import { findAction, getPlaybook, defaultPlaybookConfig } from './playbooks'
import type { PlaybookConfig } from './playbooks'

/** Demo staff label. CrowdX has no authentication, so this identity is NOT verified. */
export const DEMO_ACTOR = 'Demo staff'

export function readAllActionEvents(db: CrowdXDb): Promise<ActionEvent[]> {
  return db.getAll('actionEvents')
}

/** Events in the order they were recorded for one incident+action. */
export function sortEvents<T extends Pick<ActionEvent, 'seq' | 'at' | 'id'>>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => a.seq - b.seq || a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
}

/** True when the latest event for the action is COMPLETED. */
export function isCompleted(events: readonly ActionEvent[]): boolean {
  const ordered = sortEvents(events)
  return ordered.length > 0 && ordered[ordered.length - 1].type === 'COMPLETED'
}

export interface RecordRequest {
  incidentId: string
  actionId: string
  type: ActionEventType
  /** Event time (ISO 8601). Injected so callers and tests control the clock. */
  at: string
  actor?: string
}

export type RecordResult =
  | { applied: true; event: ActionEvent }
  | { applied: false; reason: 'ALREADY_COMPLETED' | 'NOT_COMPLETED' | 'UNKNOWN_INCIDENT' | 'UNKNOWN_ACTION' | 'INVALID_TIME' }

/**
 * Records one event atomically. In a single readwrite transaction it checks the incident exists, the action belongs to
 * the incident's playbook, and the event would actually change state. Repeated clicks, retries and double submits
 * therefore resolve to one event: a second COMPLETED for a completed action (or UNDONE for an incomplete one) is a no-op.
 */
export async function recordActionEvent(db: CrowdXDb, request: RecordRequest, config: PlaybookConfig = defaultPlaybookConfig): Promise<RecordResult> {
  if (!Number.isFinite(Date.parse(request.at))) return { applied: false, reason: 'INVALID_TIME' }
  const tx = db.transaction(['incidents', 'actionEvents'], 'readwrite')
  const incident = await tx.objectStore('incidents').get(request.incidentId)
  if (!incident) {
    await tx.done
    return { applied: false, reason: 'UNKNOWN_INCIDENT' }
  }
  if (!findAction(request.actionId, config) || !getPlaybook(incident.severity, config).some((action) => action.id === request.actionId)) {
    await tx.done
    return { applied: false, reason: 'UNKNOWN_ACTION' }
  }
  const store = tx.objectStore('actionEvents')
  const existing = (await store.index('by-incident').getAll(request.incidentId)).filter((event) => event.actionId === request.actionId)
  const completed = isCompleted(existing)
  if (request.type === 'COMPLETED' && completed) {
    await tx.done
    return { applied: false, reason: 'ALREADY_COMPLETED' }
  }
  if (request.type === 'UNDONE' && !completed) {
    await tx.done
    return { applied: false, reason: 'NOT_COMPLETED' }
  }
  const event: ActionEvent = {
    id: crypto.randomUUID(),
    incidentId: request.incidentId,
    actionId: request.actionId,
    type: request.type,
    at: new Date(request.at).toISOString(),
    actor: request.actor ?? DEMO_ACTOR,
    seq: existing.length + 1,
  }
  await Promise.all([store.add(event), tx.done])
  return { applied: true, event }
}
