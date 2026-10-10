import { describe, expect, it } from 'vitest'
import { bandForScore, buildStationIndex, defaultRiskConfig, parseTime, scoreIncident, scoreIncidents } from './riskScoring'
import type { RiskConfig } from './riskScoring'
import { summariseRisk, summariseStationRisk } from './riskSummary'
import { sortIncidents } from '../lib/incidents'
import type { Incident, IncidentStatus, Severity } from '../types'

const NOW = Date.parse('2026-10-10T12:00:00.000Z')
const minutesAgo = (m: number) => new Date(NOW - m * 60000).toISOString()

let counter = 0
function report(overrides: Partial<Incident> = {}): Incident {
  counter += 1
  return {
    id: `r${counter}`,
    station: 'GNLU',
    stationId: 'ST_GNLU',
    zone: 'Concourse',
    severity: 'LOW',
    notes: 'note',
    status: 'OPEN',
    createdAt: minutesAgo(0),
    updatedAt: minutesAgo(0),
    history: [{ status: 'OPEN', at: minutesAgo(0) }],
    ...overrides,
  }
}

const score = (r: Incident, others: Incident[] = [], now: number | string = NOW, config?: RiskConfig) => scoreIncident(r, [r, ...others], now, config)

describe('severity factor', () => {
  it.each([['LOW', 10], ['MEDIUM', 20], ['HIGH', 30], ['CRITICAL', 40]] as [Severity, number][])('%s = %i points', (severity, points) => {
    const result = score(report({ severity }))
    expect(result.factors.severity.points).toBe(points)
    expect(result.score).toBe(points)
  })
})

describe('unresolved duration factor', () => {
  it.each([[0, 0], [4.99, 0], [5, 5], [14.99, 5], [15, 10], [29.99, 10], [30, 20], [59.99, 20], [60, 30], [600, 30]])('%f minutes = %i points', (minutes, points) => {
    expect(score(report({ createdAt: minutesAgo(minutes) })).factors.duration.points).toBe(points)
  })

  it('keeps ageing while ACKNOWLEDGED', () => {
    const r = report({ status: 'ACKNOWLEDGED', createdAt: minutesAgo(45) })
    expect(score(r).factors.duration.points).toBe(20)
    expect(score(r).eligibleForActive).toBe(true)
  })

  it('RESOLVED reports earn no age points and are not active', () => {
    const r = report({ status: 'RESOLVED', severity: 'CRITICAL', createdAt: minutesAgo(5000) })
    const result = score(r)
    expect(result.factors.duration.points).toBe(0)
    expect(result.score).toBe(40)
    expect(result.eligibleForActive).toBe(false)
  })

  it('reports how the duration factor will change', () => {
    expect(score(report({ createdAt: minutesAgo(10) })).factors.duration.nextChange).toContain('15 minutes')
    expect(score(report({ createdAt: minutesAgo(90) })).factors.duration.nextChange).toBeUndefined()
  })
})

describe('repeat-report factor', () => {
  const repeats = (n: number, overrides: Partial<Incident> = {}) => Array.from({ length: n }, () => report({ createdAt: minutesAgo(10), ...overrides }))

  it.each([[0, 0], [1, 10], [2, 20], [3, 30], [4, 30], [9, 30]])('%i other reports = %i points', (n, points) => {
    expect(score(report(), repeats(n)).factors.recurrence.points).toBe(points)
  })

  it('does not count reports from other stations', () => {
    const elsewhere = repeats(3, { station: 'GIFT City', stationId: 'ST_GIFT_CITY' })
    expect(score(report(), elsewhere).factors.recurrence.points).toBe(0)
  })

  it('does not count the incident itself', () => {
    const r = report()
    expect(scoreIncident(r, [r, r, r], NOW).factors.recurrence.points).toBe(0)
  })

  it('does not count resolved reports', () => {
    expect(score(report(), repeats(3, { status: 'RESOLVED' })).factors.recurrence.points).toBe(0)
  })

  it('excludes reports outside the window and includes the boundary', () => {
    expect(score(report(), [report({ createdAt: minutesAgo(61) })]).factors.recurrence.points).toBe(0)
    expect(score(report(), [report({ createdAt: minutesAgo(60) })]).factors.recurrence.points).toBe(10)
  })

  it('honours a configured window', () => {
    const config = { ...defaultRiskConfig, recurrenceWindowMinutes: 15 }
    expect(score(report(), [report({ createdAt: minutesAgo(20) })], NOW, config).factors.recurrence.points).toBe(0)
    expect(score(report(), [report({ createdAt: minutesAgo(10) })], NOW, config).factors.recurrence.points).toBe(10)
  })

  it('ignores reports with invalid or future timestamps', () => {
    const others = [report({ createdAt: 'nope' }), report({ createdAt: '' }), report({ createdAt: minutesAgo(-30) })]
    expect(score(report(), others).factors.recurrence.points).toBe(0)
  })

  it('resolves legacy reports without station IDs by name or alias', () => {
    const legacy = [report({ station: 'GNLU', stationId: undefined }), report({ station: 'Gujarat National Law University', stationId: undefined })]
    expect(score(report(), legacy).factors.recurrence.points).toBe(20)
    const sector = report({ station: 'Gandhinagar Sector 1', stationId: undefined })
    expect(score(sector, [report({ station: 'Sector 1', stationId: 'ST_SECTOR_1' })]).factors.recurrence.points).toBe(10)
  })

  it('counts a duplicated record of one incident once', () => {
    const dup = report({ createdAt: minutesAgo(5) })
    expect(score(report(), [dup, { ...dup }]).factors.recurrence.points).toBe(10)
  })

  it('does not group reports for stations it cannot identify under one key', () => {
    const a = report({ station: '', stationId: undefined })
    expect(score(a, [report({ station: '', stationId: undefined })]).factors.recurrence.points).toBe(0)
  })

  it('groups unknown stations by normalised name', () => {
    const a = report({ station: 'Test  Halt', stationId: undefined })
    expect(score(a, [report({ station: 'test halt', stationId: undefined })]).factors.recurrence.points).toBe(10)
  })
})

describe('robustness', () => {
  it('handles invalid and missing timestamps without NaN', () => {
    for (const createdAt of ['garbage', '', undefined as unknown as string, null as unknown as string]) {
      const result = score(report({ createdAt, severity: 'HIGH' }))
      expect(result.factors.duration.points).toBe(0)
      expect(Number.isFinite(result.score)).toBe(true)
      expect(result.score).toBe(30)
    }
  })

  it('handles an invalid reference time', () => {
    const result = score(report({ severity: 'HIGH' }), [], 'not a date')
    expect(result.score).toBe(30)
    expect(result.referenceTime).toBeNull()
  })

  it('future timestamps never produce negative age points', () => {
    const result = score(report({ createdAt: minutesAgo(-120) }))
    expect(result.factors.duration.points).toBe(0)
    expect(result.score).toBeGreaterThanOrEqual(0)
  })

  it('survives malformed reports', () => {
    const malformed = [{}, { id: 'x' }, { id: 'y', severity: 'EXTREME', status: 'WEIRD' }] as unknown as Incident[]
    for (const m of malformed) {
      const result = scoreIncident(m, malformed, NOW)
      expect(Number.isFinite(result.score)).toBe(true)
      expect(result.eligibleForActive).toBe(false)
    }
    expect(() => scoreIncidents([...malformed, null as unknown as Incident], NOW)).not.toThrow()
  })

  it('clamps scores to 0-100', () => {
    const big: RiskConfig = { ...defaultRiskConfig, severityPoints: { LOW: 500, MEDIUM: 500, HIGH: 500, CRITICAL: 500 } }
    expect(score(report(), [], NOW, big).score).toBe(100)
    const negative: RiskConfig = { ...defaultRiskConfig, severityPoints: { LOW: -50, MEDIUM: -50, HIGH: -50, CRITICAL: -50 } }
    expect(score(report(), [], NOW, negative).score).toBe(0)
  })

  it('maximum default score is exactly 100', () => {
    const r = report({ severity: 'CRITICAL', createdAt: minutesAgo(60) })
    const others = [1, 2, 3].map(() => report({ createdAt: minutesAgo(10) }))
    expect(score(r, others).score).toBe(100)
  })
})

describe('risk bands', () => {
  it.each([[0, 'LOW'], [24, 'LOW'], [25, 'MODERATE'], [49, 'MODERATE'], [50, 'HIGH'], [74, 'HIGH'], [75, 'CRITICAL'], [100, 'CRITICAL']])('score %i is %s', (value, band) => {
    expect(bandForScore(value)).toBe(band)
  })

  it('result carries the band for its score', () => {
    expect(score(report({ severity: 'CRITICAL', createdAt: minutesAgo(30) })).riskBand).toBe('HIGH') // 40 + 20
    expect(score(report({ severity: 'CRITICAL', createdAt: minutesAgo(60), }), [report({ createdAt: minutesAgo(1) })]).riskBand).toBe('CRITICAL') // 40+30+10
  })
})

describe('purity', () => {
  it('is deterministic', () => {
    const r = report({ severity: 'HIGH', createdAt: minutesAgo(20) })
    const others = [report({ createdAt: minutesAgo(5) })]
    expect(score(r, others)).toEqual(score(r, others))
  })

  it('never mutates inputs', () => {
    const r = report({ severity: 'HIGH', createdAt: minutesAgo(20) })
    const others = [report({ createdAt: minutesAgo(5) })]
    const before = JSON.stringify([r, others])
    const frozen = [Object.freeze({ ...r, history: Object.freeze([...r.history]) as never }), ...others.map((o) => Object.freeze({ ...o }))]
    scoreIncident(frozen[0], frozen, NOW)
    scoreIncidents(frozen, NOW)
    expect(JSON.stringify([r, others])).toBe(before)
  })

  it('accepts Date, ISO string and epoch references identically', () => {
    const r = report({ createdAt: minutesAgo(20) })
    expect(score(r, [], new Date(NOW).toISOString())).toEqual(scoreIncident(r, [r], new Date(NOW)))
    expect(parseTime(NOW)).toBe(NOW)
  })

  it('scoreIncidents matches per-report scoreIncident', () => {
    const all = [report({ severity: 'HIGH', createdAt: minutesAgo(40) }), report({ createdAt: minutesAgo(10) }), report({ station: 'GIFT City', stationId: 'ST_GIFT_CITY' }), report({ status: 'RESOLVED' })]
    const batch = scoreIncidents(all, NOW)
    for (const r of all) expect(batch.get(r.id)).toEqual(scoreIncident(r, all, NOW))
  })

  it('exposes a grouped station index', () => {
    const index = buildStationIndex([report(), report(), report({ station: 'GIFT City', stationId: 'ST_GIFT_CITY' })], NOW)
    expect(index.byStation.get('ST_GNLU')).toHaveLength(2)
    expect(index.byStation.get('ST_GIFT_CITY')).toHaveLength(1)
  })

  it('explains each factor in the reasons', () => {
    const r = report({ severity: 'HIGH', createdAt: minutesAgo(20) })
    const result = score(r, [report({ createdAt: minutesAgo(3) })])
    expect(result.reasons).toHaveLength(3)
    expect(result.reasons.join(' ')).toMatch(/HIGH/)
    expect(result.reasons.join(' ')).toMatch(/20 minutes/)
    expect(result.reasons.join(' ')).toMatch(/1 other unresolved report/)
  })

  it('matches the worked example in the README', () => {
    const r = report({ severity: 'HIGH', createdAt: minutesAgo(35) })
    const result = score(r, [report({ createdAt: minutesAgo(10) }), report({ createdAt: minutesAgo(50) })])
    expect([result.factors.severity.points, result.factors.duration.points, result.factors.recurrence.points, result.score, result.riskBand]).toEqual([30, 20, 20, 70, 'HIGH'])
  })
})

describe('active eligibility, ordering and summaries', () => {
  const status = (s: IncidentStatus) => report({ status: s })

  it('OPEN and ACKNOWLEDGED are active, RESOLVED is not', () => {
    expect(score(status('OPEN')).eligibleForActive).toBe(true)
    expect(score(status('ACKNOWLEDGED')).eligibleForActive).toBe(true)
    expect(score(status('RESOLVED')).eligibleForActive).toBe(false)
  })

  const set = [
    report({ id: 'low-old', severity: 'LOW', createdAt: minutesAgo(3) }),
    report({ id: 'crit-new', severity: 'CRITICAL', createdAt: minutesAgo(1) }),
    report({ id: 'resolved-crit', severity: 'CRITICAL', status: 'RESOLVED', createdAt: minutesAgo(900) }),
    report({ id: 'gift', severity: 'HIGH', createdAt: minutesAgo(40), station: 'GIFT City', stationId: 'ST_GIFT_CITY' }),
  ]
  const risks = scoreIncidents(set, NOW)

  it('orders active first, then score, with resolved last', () => {
    expect(sortIncidents(set, risks).map((i) => i.id)).toEqual(['crit-new', 'gift', 'low-old', 'resolved-crit'])
  })

  it('breaks ties by severity then age then id', () => {
    const a = report({ id: 'a', severity: 'MEDIUM' })
    const b = report({ id: 'b', severity: 'MEDIUM' })
    const tie = scoreIncidents([b, a], NOW)
    expect(sortIncidents([b, a], tie).map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('summarises active risk by band and excludes resolved reports', () => {
    const overview = summariseRisk(set, risks)
    expect(overview.activeTotal).toBe(3)
    expect(overview.counts.CRITICAL + overview.counts.HIGH + overview.counts.MODERATE + overview.counts.LOW).toBe(3)
    expect(overview.top.map((t) => t.incident.id)).toEqual(['crit-new', 'gift', 'low-old'])
  })

  it('summarises stations, highest risk first, using active reports only', () => {
    const stations = summariseStationRisk(set, risks)
    expect(stations.map((s) => s.station.id)).toEqual(['ST_GNLU', 'ST_GIFT_CITY'])
    expect(stations[0]).toMatchObject({ active: 2, critical: 1 })
    expect(stations[0].maxScore).toBe(risks.get('crit-new')!.score)
  })

  it('a status change immediately removes a report from active risk', () => {
    const after = set.map((i) => (i.id === 'crit-new' ? { ...i, status: 'RESOLVED' as const } : i))
    const overview = summariseRisk(after, scoreIncidents(after, NOW))
    expect(overview.top.map((t) => t.incident.id)).not.toContain('crit-new')
  })

  it('a new report at a station raises its neighbours recurrence score', () => {
    const base = report({ severity: 'LOW' })
    const before = scoreIncidents([base], NOW).get(base.id)!.score
    const withNew = scoreIncidents([base, report({ createdAt: minutesAgo(1) })], NOW).get(base.id)!.score
    expect(withNew - before).toBe(10)
  })
})
