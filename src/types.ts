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
  station: string
  zone: string
  severity: Severity
  notes: string
  status: IncidentStatus
  createdAt: string
  updatedAt: string
  history: StatusEvent[]
}

export type NewIncident = Pick<Incident, 'station' | 'zone' | 'severity' | 'notes'>
