export const statuses = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const
export type IncidentStatus = (typeof statuses)[number]

export const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const
export type Severity = (typeof severities)[number]

export interface StatusEvent {
  status: IncidentStatus
  at: string
}

export interface Incident {
  id: string
  /** Display name at the time of the report. */
  station: string
  /** Stable station ID; absent on reports saved before station IDs existed. */
  stationId?: string
  zone: string
  severity: Severity
  notes: string
  status: IncidentStatus
  createdAt: string
  updatedAt: string
  history: StatusEvent[]
}

export type NewIncident = Pick<Incident, 'station' | 'stationId' | 'zone' | 'severity' | 'notes'>

export const actionEventTypes = ['COMPLETED', 'UNDONE'] as const
export type ActionEventType = (typeof actionEventTypes)[number]

/**
 * One entry in the append-only response-checklist log for an incident. The current state of an action is
 * derived from its latest event; events are never edited or deleted.
 */
export interface ActionEvent {
  id: string
  incidentId: string
  actionId: string
  type: ActionEventType
  /** ISO 8601 time the event was recorded. */
  at: string
  /** Demo staff label. Not a verified identity. */
  actor: string
  /** 1-based position among this incident+action's events; gives a stable order even when timestamps tie. */
  seq: number
}
