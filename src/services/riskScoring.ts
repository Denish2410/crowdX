/**
 * CrowdX crowd-risk scoring: deterministic, explainable, offline decision support.
 *
 * score (0-100) = severity points (max 40) + unresolved-duration points (max 30) + repeat-report points (max 30)
 *
 * The score is a heuristic for prioritising staff attention. It is NOT a validated prediction, a measurement
 * of passenger density, or an official metro safety rule. Band thresholds are uncalibrated demo defaults.
 * The functions here are pure: no DOM, network, IndexedDB, clock reads or input mutation.
 */
import { getStationById, resolveStation } from '../data/stations'
import type { Incident, Severity } from '../types'

export type RiskBand = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'

export interface DurationStep {
  /** Step applies once the unresolved duration reaches this many minutes (inclusive). */
  minMinutes: number
  points: number
}

export interface RiskConfig {
  severityPoints: Record<Severity, number>
  /** Ascending by minMinutes. */
  durationSteps: DurationStep[]
  /** recurrencePoints[n] = points for n other relevant reports; counts above the last index use the last entry. */
  recurrencePoints: number[]
  /** A repeat report counts when it was opened within this many minutes before the reference time (inclusive). */
  recurrenceWindowMinutes: number
  /** Descending by min; the first band whose min is <= score applies. */
  bands: { min: number; band: RiskBand }[]
}

export const defaultRiskConfig: RiskConfig = {
  severityPoints: { LOW: 10, MEDIUM: 20, HIGH: 30, CRITICAL: 40 },
  durationSteps: [
    { minMinutes: 0, points: 0 },
    { minMinutes: 5, points: 5 },
    { minMinutes: 15, points: 10 },
    { minMinutes: 30, points: 20 },
    { minMinutes: 60, points: 30 },
  ],
  recurrencePoints: [0, 10, 20, 30],
  recurrenceWindowMinutes: 60,
  bands: [
    { min: 75, band: 'CRITICAL' },
    { min: 50, band: 'HIGH' },
    { min: 25, band: 'MODERATE' },
    { min: 0, band: 'LOW' },
  ],
}

export const riskBandLabel: Record<RiskBand, string> = { LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High', CRITICAL: 'Critical' }

export interface RiskFactor {
  points: number
  max: number
  /** Short description of the input that produced the points. */
  detail: string
  /** What would raise this factor next, if anything. */
  nextChange?: string
}

export interface RiskResult {
  incidentId: string
  /** Sum of factor points, clamped to 0-100. */
  score: number
  riskBand: RiskBand
  factors: { severity: RiskFactor; duration: RiskFactor; recurrence: RiskFactor }
  /** Human-readable reasons, one per contributing factor plus any data-quality notes. */
  reasons: string[]
  /** True for OPEN and ACKNOWLEDGED reports only; resolved or malformed-status reports never rank as active risk. */
  eligibleForActive: boolean
  /** ISO time the score was calculated for, or null when the reference time was invalid. */
  referenceTime: string | null
}

export type TimeInput = number | string | Date

/** Parses a timestamp to epoch milliseconds, or null when missing or invalid. */
export function parseTime(value: unknown): number | null {
  if (value instanceof Date) value = value.getTime()
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const isActiveStatus = (status: unknown) => status === 'OPEN' || status === 'ACKNOWLEDGED'
const maxOf = (values: number[]) => values.reduce((a, b) => Math.max(a, b), 0)

/**
 * Station identity used for repeat counting. Resolution order: known stationId, then station name/alias
 * (legacy reports saved before IDs existed), then the trimmed lower-cased raw name. Null when no station is recorded.
 */
export function stationKey(report: Pick<Incident, 'station' | 'stationId'>): string | null {
  const name = typeof report.station === 'string' ? report.station : ''
  const stationId = typeof report.stationId === 'string' ? report.stationId : undefined
  const station = resolveStation({ stationId, station: name })
  if (station) return station.id
  const raw = name.trim().toLowerCase().replace(/\s+/g, ' ')
  return raw ? `name:${raw}` : null
}

interface ActiveEntry {
  id: string
  createdAt: number
}

/** Unresolved reports grouped by station, restricted to the recurrence window. Build once, score many. */
export interface StationIndex {
  byStation: Map<string, ActiveEntry[]>
  windowMinutes: number
}

export function buildStationIndex(reports: readonly Incident[], now: TimeInput, config: RiskConfig = defaultRiskConfig): StationIndex {
  const nowMs = parseTime(now)
  const byStation = new Map<string, ActiveEntry[]>()
  const seen = new Set<string>()
  if (nowMs !== null) {
    for (const report of reports) {
      if (!report || typeof report.id !== 'string' || seen.has(report.id) || !isActiveStatus(report.status)) continue
      const createdAt = parseTime(report.createdAt)
      const key = stationKey(report)
      if (createdAt === null || key === null) continue
      const ageMinutes = (nowMs - createdAt) / 60000
      if (ageMinutes < 0 || ageMinutes > config.recurrenceWindowMinutes) continue
      seen.add(report.id)
      const list = byStation.get(key)
      if (list) list.push({ id: report.id, createdAt })
      else byStation.set(key, [{ id: report.id, createdAt }])
    }
  }
  return { byStation, windowMinutes: config.recurrenceWindowMinutes }
}

export function bandForScore(score: number, config: RiskConfig = defaultRiskConfig): RiskBand {
  const value = Number.isFinite(score) ? score : 0
  const bands = [...config.bands].sort((a, b) => b.min - a.min)
  return (bands.find((entry) => value >= entry.min) ?? bands[bands.length - 1]).band
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function formatMinutes(minutes: number) {
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return plural(Math.floor(minutes), 'minute')
  const hours = Math.floor(minutes / 60)
  const rest = Math.floor(minutes % 60)
  return rest ? `${plural(hours, 'hour')} ${plural(rest, 'minute')}` : plural(hours, 'hour')
}

/**
 * Scores one report against an already-built station index (use scoreIncidents to score a whole list).
 * Resolved reports keep a historical score of severity points only: duration and recurrence are 0 and they are
 * never eligible for active-risk lists, so old resolved reports cannot look like live risks.
 */
export function scoreWithIndex(report: Incident, index: StationIndex, now: TimeInput, config: RiskConfig = defaultRiskConfig): RiskResult {
  const nowMs = parseTime(now)
  const reasons: string[] = []
  const eligibleForActive = isActiveStatus(report?.status)
  const resolved = report?.status === 'RESOLVED'

  // A. Severity
  const severityMax = maxOf(Object.values(config.severityPoints))
  const severityKnown = typeof report?.severity === 'string' && Object.prototype.hasOwnProperty.call(config.severityPoints, report.severity)
  const severityPts = severityKnown ? config.severityPoints[report.severity] : 0
  const severityFactor: RiskFactor = {
    points: severityPts,
    max: severityMax,
    detail: severityKnown ? `Reported severity ${report.severity}` : 'Severity missing or unrecognised',
  }
  reasons.push(severityKnown ? `Staff-reported severity ${report.severity} contributes ${severityPts} of ${severityMax} points.` : 'Severity is missing or unrecognised, so it contributes 0 points.')

  // B. Unresolved duration (OPEN and ACKNOWLEDGED both keep ageing until RESOLVED)
  const durationMax = maxOf(config.durationSteps.map((step) => step.points))
  const createdMs = parseTime(report?.createdAt)
  let durationPts = 0
  let durationFactor: RiskFactor
  if (resolved) {
    durationFactor = { points: 0, max: durationMax, detail: 'Resolved: no age points accrue' }
    reasons.push('Resolved reports do not gain unresolved-duration points.')
  } else if (createdMs === null || nowMs === null) {
    durationFactor = { points: 0, max: durationMax, detail: 'Report time unavailable' }
    reasons.push('Report or reference time is invalid, so unresolved duration contributes 0 points.')
  } else {
    const minutes = Math.max(0, (nowMs - createdMs) / 60000) // future timestamps count as just reported
    const steps = [...config.durationSteps].sort((a, b) => a.minMinutes - b.minMinutes)
    const current = [...steps].reverse().find((step) => minutes >= step.minMinutes)
    durationPts = current?.points ?? 0
    const next = steps.find((step) => step.minMinutes > minutes && step.points > durationPts)
    durationFactor = {
      points: durationPts,
      max: durationMax,
      detail: `Unresolved for ${formatMinutes(minutes)}`,
      nextChange: next ? `Adds ${next.points - durationPts} more points at ${formatMinutes(next.minMinutes)} if still unresolved.` : undefined,
    }
    reasons.push(`Unresolved for ${formatMinutes(minutes)}, which contributes ${durationPts} of ${durationMax} points.`)
  }

  // C. Repeated reports at the same station (other unresolved reports opened within the window)
  const recurrenceMax = maxOf(config.recurrencePoints)
  const key = stationKey(report ?? ({} as Incident))
  let recurrencePts = 0
  let recurrenceFactor: RiskFactor
  if (resolved) {
    recurrenceFactor = { points: 0, max: recurrenceMax, detail: 'Resolved: recurrence not applied' }
  } else if (key === null || nowMs === null) {
    recurrenceFactor = { points: 0, max: recurrenceMax, detail: 'Station or reference time unavailable' }
    reasons.push('Station is unknown, so repeat reports are not counted.')
  } else {
    const others = (index.byStation.get(key) ?? []).filter((entry) => entry.id !== report.id).length
    const table = config.recurrencePoints
    recurrencePts = table.length ? table[Math.min(others, table.length - 1)] : 0
    const stationName = getStationById(key)?.name ?? report.station
    recurrenceFactor = {
      points: recurrencePts,
      max: recurrenceMax,
      detail: `${plural(others, 'other unresolved report')} at ${stationName} in the last ${index.windowMinutes} minutes`,
      nextChange: others < table.length - 1
        ? `Another unresolved report at this station within ${index.windowMinutes} minutes would add ${table[Math.min(others + 1, table.length - 1)] - recurrencePts} points.`
        : undefined,
    }
    reasons.push(
      others === 0
        ? `No other unresolved reports at ${stationName} in the last ${index.windowMinutes} minutes (0 points).`
        : `${plural(others, 'other unresolved report')} at ${stationName} in the last ${index.windowMinutes} minutes contributes ${recurrencePts} of ${recurrenceMax} points.`,
    )
  }

  const score = Math.min(100, Math.max(0, severityPts + durationPts + recurrencePts))
  return {
    incidentId: typeof report?.id === 'string' ? report.id : '',
    score,
    riskBand: bandForScore(score, config),
    factors: { severity: severityFactor, duration: durationFactor, recurrence: recurrenceFactor },
    reasons,
    eligibleForActive,
    referenceTime: nowMs === null ? null : new Date(nowMs).toISOString(),
  }
}

/** Scores one report against a list of relevant reports (the report itself may be included; it is never counted). */
export function scoreIncident(report: Incident, relevantReports: readonly Incident[], now: TimeInput, config: RiskConfig = defaultRiskConfig): RiskResult {
  return scoreWithIndex(report, buildStationIndex(relevantReports, now, config), now, config)
}

/** Scores every report with one grouped station index: O(n) to build plus O(reports per station) per report. */
export function scoreIncidents(reports: readonly Incident[], now: TimeInput, config: RiskConfig = defaultRiskConfig): Map<string, RiskResult> {
  const index = buildStationIndex(reports, now, config)
  const results = new Map<string, RiskResult>()
  for (const report of reports) {
    if (report && typeof report.id === 'string') results.set(report.id, scoreWithIndex(report, index, now, config))
  }
  return results
}
