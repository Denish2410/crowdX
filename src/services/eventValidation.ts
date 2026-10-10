/** Strict validation of imported checklist events. Never trusts the file; nothing is coerced. */
import { actionEventTypes } from '../types'
import type { ActionEvent, Incident } from '../types'
import { isIsoTimestamp } from './backupFormat'
import { defaultPlaybookConfig, getPlaybook } from './playbooks'
import type { PlaybookConfig } from './playbooks'

export type EventKind = 'ATTACH' | 'NOT_RESTORED' | 'UNKNOWN_INCIDENT' | 'DUPLICATE' | 'INVALID'

export interface EventPlanItem {
  index: number
  kind: EventKind
  event?: ActionEvent
  reason?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Field-level validation of one event. Returns a clean ActionEvent or the reasons it is invalid. */
export function validateEventShape(raw: unknown): { event?: ActionEvent; errors: string[] } {
  if (!isRecord(raw)) return { errors: ['Event is not an object.'] }
  const errors: string[] = []
  const text = (key: 'id' | 'incidentId' | 'actionId' | 'actor') => {
    const value = raw[key]
    if (typeof value !== 'string' || value.trim() === '' || value.length > 500) errors.push(`"${key}" must be a non-empty string.`)
    return typeof value === 'string' ? value : ''
  }
  const id = text('id')
  const incidentId = text('incidentId')
  const actionId = text('actionId')
  const actor = text('actor')
  if (!(actionEventTypes as readonly unknown[]).includes(raw.type)) errors.push(`"type" must be one of ${actionEventTypes.join(', ')}.`)
  if (!isIsoTimestamp(raw.at)) errors.push('"at" must be an ISO 8601 timestamp.')
  if (typeof raw.seq !== 'number' || !Number.isInteger(raw.seq) || raw.seq < 1) errors.push('"seq" must be a positive integer.')
  if (errors.length) return { errors }
  return { event: { id, incidentId, actionId, actor, type: raw.type as ActionEvent['type'], at: raw.at as string, seq: raw.seq as number }, errors }
}

/**
 * Classifies imported events. Events are only restored together with an incident that is itself being newly restored
 * (so they cannot be attached to, or alter, a stored report). Each incident+action log must be a valid sequence:
 * seq 1..n with no gaps, strictly alternating COMPLETED/UNDONE starting with COMPLETED, timestamps not going backwards,
 * and the action must belong to the playbook for that incident's severity.
 *
 * @param fileIncidents  validated incidents from the backup file, by ID
 * @param storedIncidentIds IDs already in the database
 * @param restorableIds  IDs of file incidents that would be added (kind ADD)
 * @param existingEventIds event IDs already in the database
 */
export function planEvents(
  rawEvents: readonly unknown[],
  fileIncidents: ReadonlyMap<string, Incident>,
  storedIncidentIds: ReadonlySet<string>,
  restorableIds: ReadonlySet<string>,
  existingEventIds: ReadonlySet<string>,
  config: PlaybookConfig = defaultPlaybookConfig,
): EventPlanItem[] {
  const items: EventPlanItem[] = rawEvents.map((raw, index) => {
    const { event, errors } = validateEventShape(raw)
    return event ? { index, kind: 'ATTACH', event } : { index, kind: 'INVALID', reason: errors.join(' ') }
  })

  const seenIds = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'ATTACH' || !item.event) continue
    const { event } = item
    if (existingEventIds.has(event.id) || seenIds.has(event.id)) {
      item.kind = 'DUPLICATE'
      item.reason = existingEventIds.has(event.id) ? 'An event with this ID is already stored.' : 'Repeats an earlier event ID in this file.'
      continue
    }
    seenIds.add(event.id)
    const incident = fileIncidents.get(event.incidentId)
    if (!incident) {
      item.kind = 'UNKNOWN_INCIDENT'
      item.reason = storedIncidentIds.has(event.incidentId) ? 'Refers to a stored report that is not part of this backup.' : 'Refers to an incident that does not exist.'
      continue
    }
    if (!getPlaybook(incident.severity, config).some((action) => action.id === event.actionId)) {
      item.kind = 'INVALID'
      item.reason = `Action "${event.actionId}" is not in the playbook for ${incident.severity} incidents.`
      continue
    }
    if (!restorableIds.has(event.incidentId)) {
      item.kind = 'NOT_RESTORED'
      item.reason = 'Its report is not being restored (already stored, conflicting or invalid), so stored checklists are left unchanged.'
    }
  }

  // Sequence integrity per incident+action. One bad event invalidates its whole log.
  const groups = new Map<string, EventPlanItem[]>()
  for (const item of items) {
    if (item.kind !== 'ATTACH' || !item.event) continue
    const key = `${item.event.incidentId}\u0000${item.event.actionId}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => a.event!.seq - b.event!.seq)
    const problem = ordered.reduce<string | null>((found, item, position) => {
      if (found) return found
      const { event } = item
      if (event!.seq !== position + 1) return 'its sequence numbers are not 1..n without gaps or repeats'
      if (event!.type !== (position % 2 === 0 ? 'COMPLETED' : 'UNDONE')) return 'its events do not alternate COMPLETED/UNDONE starting with COMPLETED'
      if (position > 0 && Date.parse(event!.at) < Date.parse(ordered[position - 1].event!.at)) return 'its timestamps go backwards'
      return null
    }, null)
    if (problem) group.forEach((item) => { item.kind = 'INVALID'; item.reason = `Checklist log rejected: ${problem}.` })
  }
  return items
}
