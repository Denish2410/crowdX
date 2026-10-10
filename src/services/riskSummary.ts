/** Pure aggregation helpers that turn scored reports into dashboard and station summaries. */
import { resolveStation } from '../data/stations'
import type { MetroStation } from '../data/stations'
import type { Incident } from '../types'
import type { RiskBand, RiskResult } from './riskScoring'

export interface RiskOverview {
  /** Active reports per calculated risk band. */
  counts: Record<RiskBand, number>
  activeTotal: number
  /** Highest-risk active reports, deterministic order. */
  top: { incident: Incident; risk: RiskResult }[]
}

const severityRank: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }

/** Score descending, then reported severity descending, then oldest first, then ID for a total order. */
export function compareByRisk(a: Incident, b: Incident, risks: ReadonlyMap<string, RiskResult>) {
  const scoreDelta = (risks.get(b.id)?.score ?? 0) - (risks.get(a.id)?.score ?? 0)
  if (scoreDelta) return scoreDelta
  const severityDelta = (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0)
  if (severityDelta) return severityDelta
  const timeDelta = (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)
  return timeDelta || a.id.localeCompare(b.id)
}

export function summariseRisk(incidents: readonly Incident[], risks: ReadonlyMap<string, RiskResult>, topN = 5): RiskOverview {
  const counts: Record<RiskBand, number> = { CRITICAL: 0, HIGH: 0, MODERATE: 0, LOW: 0 }
  const active = incidents.filter((incident) => risks.get(incident.id)?.eligibleForActive)
  for (const incident of active) counts[risks.get(incident.id)!.riskBand] += 1
  const top = [...active]
    .sort((a, b) => compareByRisk(a, b, risks))
    .slice(0, topN)
    .map((incident) => ({ incident, risk: risks.get(incident.id)! }))
  return { counts, activeTotal: active.length, top }
}

export interface StationRisk {
  station: MetroStation
  active: number
  critical: number
  /** Highest calculated score among the station's active reports. */
  maxScore: number
  maxBand: RiskBand
}

/** Per-station summary of active reports. Counts reports, never passengers. Sorted by highest risk first. */
export function summariseStationRisk(incidents: readonly Incident[], risks: ReadonlyMap<string, RiskResult>): StationRisk[] {
  const byStation = new Map<string, StationRisk>()
  for (const incident of incidents) {
    const risk = risks.get(incident.id)
    if (!risk?.eligibleForActive) continue
    const station = resolveStation(incident)
    if (!station) continue
    const entry = byStation.get(station.id) ?? { station, active: 0, critical: 0, maxScore: -1, maxBand: risk.riskBand }
    entry.active += 1
    if (incident.severity === 'CRITICAL') entry.critical += 1
    if (risk.score > entry.maxScore) {
      entry.maxScore = risk.score
      entry.maxBand = risk.riskBand
    }
    byStation.set(station.id, entry)
  }
  return [...byStation.values()].sort((a, b) => b.maxScore - a.maxScore || b.active - a.active || a.station.name.localeCompare(b.station.name))
}
