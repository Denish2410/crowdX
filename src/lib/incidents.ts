import { resolveStation } from '../data/stations'
import type { CorridorId } from '../data/stations'
import { compareByRisk } from '../services/riskSummary'
import type { RiskResult } from '../services/riskScoring'
import type { Incident, IncidentStatus, Severity } from '../types'

export interface IncidentFilters {
  corridor: CorridorId | 'ALL'
  stationId: string | 'ALL'
}

export const noFilters: IncidentFilters = { corridor: 'ALL', stationId: 'ALL' }

const severityWeight: Record<Severity, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }
const statusWeight: Record<IncidentStatus, number> = { OPEN: 0, ACKNOWLEDGED: 1, RESOLVED: 2 }

export const severityTone: Record<Severity, { badge: string; dot: string; bar: string }> = {
  CRITICAL: { badge: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-600', bar: 'bg-red-500' },
  HIGH: { badge: 'border-orange-200 bg-orange-50 text-orange-700', dot: 'bg-orange-500', bar: 'bg-orange-500' },
  MEDIUM: { badge: 'border-amber-200 bg-amber-50 text-amber-800', dot: 'bg-amber-500', bar: 'bg-amber-500' },
  LOW: { badge: 'border-green-200 bg-green-50 text-green-700', dot: 'bg-green-600', bar: 'bg-green-500' },
}

export const statusTone: Record<IncidentStatus, string> = {
  OPEN: 'border-red-200 bg-white text-red-700',
  ACKNOWLEDGED: 'border-blue-200 bg-tint text-brand-700',
  RESOLVED: 'border-green-200 bg-green-50 text-green-700',
}

export const statusLabel: Record<IncidentStatus, string> = { OPEN: 'Open', ACKNOWLEDGED: 'Acknowledged', RESOLVED: 'Resolved' }
export const severityLabel: Record<Severity, string> = { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' }

export const nextStatus: Partial<Record<IncidentStatus, IncidentStatus>> = { OPEN: 'ACKNOWLEDGED', ACKNOWLEDGED: 'RESOLVED' }
export const actionLabel: Partial<Record<IncidentStatus, string>> = { OPEN: 'Acknowledge', ACKNOWLEDGED: 'Resolve' }

export function relativeTime(timestamp: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

/**
 * Active (unresolved) reports first. With risk scores: score descending, then severity, then oldest first.
 * Without scores: status, severity, oldest first (the original ordering).
 */
export function sortIncidents(incidents: Incident[], risks?: ReadonlyMap<string, RiskResult>) {
  return [...incidents].sort((a, b) => {
    const activeDelta = Number(a.status === 'RESOLVED') - Number(b.status === 'RESOLVED')
    if (activeDelta) return activeDelta
    if (risks) return compareByRisk(a, b, risks)
    const statusDelta = statusWeight[a.status] - statusWeight[b.status]
    if (statusDelta) return statusDelta
    const severityDelta = severityWeight[b.severity] - severityWeight[a.severity]
    if (severityDelta) return severityDelta
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

export function filterIncidents(incidents: Incident[], filters: IncidentFilters) {
  return incidents.filter((incident) => {
    const station = resolveStation(incident)
    if (filters.stationId !== 'ALL') return station?.id === filters.stationId
    if (filters.corridor !== 'ALL') return station?.connectedCorridors.includes(filters.corridor) ?? false
    return true
  })
}
