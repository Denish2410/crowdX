import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import { DB_VERSION, openCrowdXDb } from '../lib/crowdxDb'
import type { ActionEvent, Incident, Severity } from '../types'
import { recordActionEvent, readAllActionEvents, isCompleted } from './actionTracking'
import { BACKUP_SCHEMA_VERSION, createBackup, parseBackup } from './backupFormat'
import { readAllIncidents, restoreIncidents } from './backupRestore'
import { CSV_COLUMNS, incidentsToCsv } from './csvExport'
import { deriveChecklist, elapsedUnresolvedMinutes } from './escalation'
import { planImport } from './importPlan'
import { defaultPlaybookConfig, getPlaybook } from './playbooks'
import type { PlaybookConfig } from './playbooks'

const NOW = Date.parse('2026-10-10T12:00:00.000Z')
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60000).toISOString()

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'inc-1', station: 'GNLU', stationId: 'ST_GNLU', zone: 'Concourse', severity: 'HIGH', notes: 'n', status: 'OPEN',
    createdAt: iso(10), updatedAt: iso(10), history: [{ status: 'OPEN', at: iso(10) }], ...overrides,
  }
}

let n = 0
const freshDb = () => openCrowdXDb(`pb-test-${(n += 1)}`)
const complete = (db: Awaited<ReturnType<typeof freshDb>>, incidentId: string, actionId: string, minutesAgo = 0) =>
  recordActionEvent(db, { incidentId, actionId, type: 'COMPLETED', at: iso(minutesAgo) })

function event(overrides: Partial<ActionEvent> = {}): ActionEvent {
  return { id: 'ev-1', incidentId: 'inc-1', actionId: 'PB_HIGH_REVIEW', type: 'COMPLETED', at: iso(5), actor: 'Demo staff', seq: 1, ...overrides }
}

describe('playbook selection', () => {
  it.each([['LOW', 2], ['MEDIUM', 3], ['HIGH', 3], ['CRITICAL', 3]] as [Severity, number][])('%s has %i actions, all for that severity', (severity, count) => {
    const actions = getPlaybook(severity)
    expect(actions).toHaveLength(count)
    expect(actions.every((a) => a.severity === severity)).toBe(true)
  })

  it('has unique, stable, prefixed action IDs', () => {
    const ids = defaultPlaybookConfig.actions.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['PB_LOW_REASSESS', 'PB_LOW_RECORD', 'PB_MEDIUM_RECHECK', 'PB_MEDIUM_NOTIFY', 'PB_MEDIUM_UPDATE', 'PB_HIGH_REVIEW', 'PB_HIGH_NOTIFY', 'PB_HIGH_RECORD', 'PB_CRITICAL_PROCEDURES', 'PB_CRITICAL_CONTACT', 'PB_CRITICAL_RECORD'])
  })

  it('returns nothing for an unknown severity', () => {
    expect(getPlaybook('EXTREME')).toEqual([])
    expect(getPlaybook(undefined)).toEqual([])
  })

  it('does not present itself as official procedure', () => {
    const text = JSON.stringify(defaultPlaybookConfig)
    expect(text).not.toMatch(/official GMRC/i)
  })

  it('accepts a custom configuration', () => {
    const custom: PlaybookConfig = { actions: [{ id: 'X1', title: 'T', description: 'D', severity: 'LOW', responseTargetMinutes: 3 }] }
    expect(getPlaybook('LOW', custom).map((a) => a.id)).toEqual(['X1'])
    expect(getPlaybook('HIGH', custom)).toEqual([])
  })
})

describe('action tracking (IndexedDB)', () => {
  it('records completion then undo as audit events and keeps both', async () => {
    const db = await freshDb()
    await db.put('incidents', incident())
    const done = await complete(db, 'inc-1', 'PB_HIGH_REVIEW', 5)
    expect(done).toMatchObject({ applied: true, event: { type: 'COMPLETED', seq: 1, actor: 'Demo staff', incidentId: 'inc-1', actionId: 'PB_HIGH_REVIEW' } })
    const undo = await recordActionEvent(db, { incidentId: 'inc-1', actionId: 'PB_HIGH_REVIEW', type: 'UNDONE', at: iso(3) })
    expect(undo).toMatchObject({ applied: true, event: { type: 'UNDONE', seq: 2 } })
    await complete(db, 'inc-1', 'PB_HIGH_REVIEW', 1)
    const events = await readAllActionEvents(db)
    expect(events.map((e) => [e.seq, e.type])).toEqual(expect.arrayContaining([[1, 'COMPLETED'], [2, 'UNDONE'], [3, 'COMPLETED']]))
    expect(isCompleted(events)).toBe(true)
    db.close()
  })

  it('prevents duplicate completion events from repeated clicks and concurrent retries', async () => {
    const db = await freshDb()
    await db.put('incidents', incident())
    const results = await Promise.all([complete(db, 'inc-1', 'PB_HIGH_NOTIFY'), complete(db, 'inc-1', 'PB_HIGH_NOTIFY'), complete(db, 'inc-1', 'PB_HIGH_NOTIFY')])
    expect(results.filter((r) => r.applied)).toHaveLength(1)
    expect(results.filter((r) => !r.applied).every((r) => !r.applied && r.reason === 'ALREADY_COMPLETED')).toBe(true)
    expect(await db.count('actionEvents')).toBe(1)
    db.close()
  })

  it('ignores an undo for an action that is not completed', async () => {
    const db = await freshDb()
    await db.put('incidents', incident())
    expect(await recordActionEvent(db, { incidentId: 'inc-1', actionId: 'PB_HIGH_REVIEW', type: 'UNDONE', at: iso(1) })).toEqual({ applied: false, reason: 'NOT_COMPLETED' })
    expect(await db.count('actionEvents')).toBe(0)
    db.close()
  })

  it('rejects unknown incidents, actions from another severity and invalid times', async () => {
    const db = await freshDb()
    await db.put('incidents', incident())
    expect(await complete(db, 'ghost', 'PB_HIGH_REVIEW')).toEqual({ applied: false, reason: 'UNKNOWN_INCIDENT' })
    expect(await complete(db, 'inc-1', 'PB_LOW_REASSESS')).toEqual({ applied: false, reason: 'UNKNOWN_ACTION' })
    expect(await complete(db, 'inc-1', 'NOPE')).toEqual({ applied: false, reason: 'UNKNOWN_ACTION' })
    expect(await recordActionEvent(db, { incidentId: 'inc-1', actionId: 'PB_HIGH_REVIEW', type: 'COMPLETED', at: 'yesterday' })).toEqual({ applied: false, reason: 'INVALID_TIME' })
    expect(await db.count('actionEvents')).toBe(0)
    db.close()
  })

  it('persists across a reload (database reopened) and works with no network', async () => {
    const name = `persist-${(n += 1)}`
    const first = await openCrowdXDb(name)
    await first.put('incidents', incident())
    await complete(first, 'inc-1', 'PB_HIGH_REVIEW', 4)
    first.close()
    const second = await openCrowdXDb(name)
    const events = await readAllActionEvents(second)
    expect(events).toHaveLength(1)
    expect(deriveChecklist(incident(), events, NOW).completedCount).toBe(1)
    second.close()
  })

  it('does not change the incident or its status history', async () => {
    const db = await freshDb()
    const original = incident({ history: [{ status: 'OPEN', at: iso(10) }] })
    await db.put('incidents', original)
    await complete(db, 'inc-1', 'PB_HIGH_REVIEW')
    expect(await db.get('incidents', 'inc-1')).toEqual(original)
    db.close()
  })
})

describe('checklist and escalation', () => {
  it('derives progress, who and when', () => {
    const state = deriveChecklist(incident(), [event()], NOW)
    expect(state).toMatchObject({ completedCount: 1, totalCount: 3, overdueCount: 0 })
    expect(state.items[0]).toMatchObject({ completed: true, completedBy: 'Demo staff', completedAt: iso(5) })
    expect(state.items[1].completed).toBe(false)
  })

  it('undo makes the action incomplete again; the log keeps both events', () => {
    const state = deriveChecklist(incident(), [event(), event({ id: 'ev-2', type: 'UNDONE', seq: 2, at: iso(2) })], NOW)
    expect(state.items[0].completed).toBe(false)
    expect(state.history.map((e) => e.type)).toEqual(['COMPLETED', 'UNDONE'])
  })

  it('applies targets exactly: not overdue at the target, overdue one minute later', () => {
    const at = (minutes: number) => deriveChecklist(incident({ createdAt: iso(minutes) }), [], NOW)
    expect(at(15).items[0].overdue).toBe(false) // PB_HIGH_REVIEW target 15 min
    expect(at(15.01).items[0].overdue).toBe(true)
    expect(at(16)).toMatchObject({ overdueCount: 2 }) // review + notify (both 15)
    expect(at(16).items[0].overdueByMinutes).toBe(1)
    expect(at(31).overdueCount).toBe(3)
  })

  it('completed actions are never overdue but are flagged when late', () => {
    const state = deriveChecklist(incident({ createdAt: iso(60) }), [event({ at: iso(10) })], NOW)
    expect(state.items[0]).toMatchObject({ completed: true, overdue: false, completedLate: true })
  })

  it('resolved incidents show no overdue actions', () => {
    const state = deriveChecklist(incident({ status: 'RESOLVED', createdAt: iso(500) }), [], NOW)
    expect(state.overdueCount).toBe(0)
    expect(elapsedUnresolvedMinutes(incident({ status: 'RESOLVED' }), NOW)).toBeNull()
  })

  it('is derived, not stored: the same events give different results at different times', () => {
    expect(deriveChecklist(incident(), [], NOW).overdueCount).toBe(0)
    expect(deriveChecklist(incident(), [], NOW + 30 * 60000).overdueCount).toBe(3)
  })

  it('handles missing and invalid timestamps without NaN', () => {
    for (const createdAt of ['garbage', '', undefined as unknown as string]) {
      const state = deriveChecklist(incident({ createdAt }), [], NOW)
      expect(state.overdueCount).toBe(0)
      expect(state.items.every((i) => i.dueAt === undefined)).toBe(true)
      expect(elapsedUnresolvedMinutes(incident({ createdAt }), NOW)).toBeNull()
    }
    expect(deriveChecklist(incident(), [], 'not a date').overdueCount).toBe(0)
    expect(elapsedUnresolvedMinutes(incident({ createdAt: iso(-30) }), NOW)).toBe(0) // future timestamp
    expect(elapsedUnresolvedMinutes(incident({ createdAt: iso(61) }), NOW)).toBe(61)
  })

  it('actions without a target are never overdue', () => {
    const state = deriveChecklist(incident({ severity: 'LOW', createdAt: iso(10_000) }), [], NOW)
    expect(state.items.find((i) => i.action.id === 'PB_LOW_RECORD')).toMatchObject({ overdue: false, dueAt: undefined })
  })

  it('ignores events for other incidents', () => {
    expect(deriveChecklist(incident(), [event({ incidentId: 'other' })], NOW).completedCount).toBe(0)
  })

  it('does not auto-resolve: status is untouched by completing every action', () => {
    const all = getPlaybook('HIGH').map((a, i) => event({ id: `e${i}`, actionId: a.id }))
    const i = incident()
    const state = deriveChecklist(i, all, NOW)
    expect(state.completedCount).toBe(state.totalCount)
    expect(i.status).toBe('OPEN')
  })
})

describe('database upgrade (version 1 to 2)', () => {
  it('adds the actionEvents store and keeps existing incidents untouched', async () => {
    const name = `migrate-${(n += 1)}`
    const v1 = await openDB(name, 1, { upgrade(db) { db.createObjectStore('incidents', { keyPath: 'id' }) } })
    const old = incident({ id: 'old-1', history: [{ status: 'OPEN', at: iso(10) }, { status: 'ACKNOWLEDGED', at: iso(5) }], status: 'ACKNOWLEDGED' })
    await v1.put('incidents', old)
    v1.close()

    const v2 = await openCrowdXDb(name)
    expect(v2.version).toBe(DB_VERSION)
    expect([...v2.objectStoreNames].sort()).toEqual(['actionEvents', 'incidents'])
    expect(await v2.get('incidents', 'old-1')).toEqual(old)
    expect(v2.transaction('actionEvents').store.indexNames.contains('by-incident')).toBe(true)
    expect(await recordActionEvent(v2, { incidentId: 'old-1', actionId: 'PB_HIGH_REVIEW', type: 'COMPLETED', at: iso(1) })).toMatchObject({ applied: true })
    v2.close()
  })

  it('reopening an up-to-date database changes nothing', async () => {
    const name = `reopen-${(n += 1)}`
    const a = await openCrowdXDb(name)
    await a.put('incidents', incident())
    a.close()
    const b = await openCrowdXDb(name)
    expect(await b.count('incidents')).toBe(1)
    b.close()
  })
})

describe('backup and restore with checklist events', () => {
  const inc = incident()
  const events = [event(), event({ id: 'ev-2', type: 'UNDONE', seq: 2, at: iso(3) }), event({ id: 'ev-3', type: 'COMPLETED', seq: 3, at: iso(1) })]

  it('writes schema version 2 with an actionEvents array', () => {
    const backup = createBackup([inc], new Date(NOW), events)
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(BACKUP_SCHEMA_VERSION).toBe(2)
    expect(backup.actionEvents).toHaveLength(3)
  })

  it('still accepts a version 1 backup (no events) and ignores any actionEvents in it', () => {
    const v1 = { app: 'CrowdX', schemaVersion: 1, exportedAt: iso(0), incidents: [inc] }
    expect(parseBackup(JSON.stringify(v1))).toMatchObject({ ok: true, events: [], records: [inc] })
    expect(parseBackup(JSON.stringify({ ...v1, actionEvents: [event()] }))).toMatchObject({ ok: true, events: [] })
    const plan = planImport([inc], [], [])
    expect(plan.counts.ADD).toBe(1)
    expect(plan.events).toEqual([])
  })

  it('requires actionEvents from version 2 and rejects future versions', () => {
    expect(parseBackup(JSON.stringify({ app: 'CrowdX', schemaVersion: 2, exportedAt: iso(0), incidents: [] }))).toMatchObject({ ok: false })
    expect(parseBackup(JSON.stringify({ app: 'CrowdX', schemaVersion: 3, exportedAt: iso(0), incidents: [], actionEvents: [] }))).toMatchObject({ ok: false, error: expect.stringContaining('newer') })
  })

  it('round-trips incidents and their checklist log into an empty database', async () => {
    const parsed = parseBackup(JSON.stringify(createBackup([inc], new Date(NOW), events)))
    if (!parsed.ok) throw new Error('parse failed')
    const plan = planImport(parsed.records, [], parsed.events, new Set())
    expect(plan.events.map((e) => e.kind)).toEqual(['ATTACH', 'ATTACH', 'ATTACH'])
    const db = await freshDb()
    const result = await restoreIncidents(db, plan.items.map((i) => i.incident!), plan.events.map((e) => e.event!))
    expect(result).toEqual({ added: 1, eventsAdded: 3 })
    expect((await readAllActionEvents(db)).sort((a, b) => a.seq - b.seq)).toEqual(events)
    expect(await readAllIncidents(db)).toEqual([inc])
    db.close()
  })

  it.each([
    ['unknown incident', [event({ id: 'x', incidentId: 'ghost' })], 'UNKNOWN_INCIDENT'],
    ['unknown action', [event({ id: 'x', actionId: 'PB_NOPE' })], 'INVALID'],
    ['action from another severity', [event({ id: 'x', actionId: 'PB_LOW_REASSESS' })], 'INVALID'],
    ['bad event type', [{ ...event(), type: 'DONE' }], 'INVALID'],
    ['invalid timestamp', [event({ at: 'soon' })], 'INVALID'],
    ['missing actor', [{ ...event(), actor: undefined }], 'INVALID'],
    ['bad seq', [event({ seq: 0 })], 'INVALID'],
    ['sequence gap', [event({ seq: 2 })], 'INVALID'],
    ['starts with UNDONE', [event({ type: 'UNDONE' })], 'INVALID'],
    ['timestamps going backwards', [event(), event({ id: 'e2', type: 'UNDONE', seq: 2, at: iso(60) })], 'INVALID'],
    ['not an object', ['junk'], 'INVALID'],
  ])('rejects %s', (_label, bad, kind) => {
    const plan = planImport([inc], [], bad as unknown[], new Set())
    expect(plan.events.every((e) => e.kind === kind)).toBe(true)
    expect(plan.events.length).toBeGreaterThan(0)
  })

  it('skips duplicate event IDs, in the file and already stored', () => {
    const plan = planImport([inc], [], [event(), event()], new Set())
    expect(plan.events.map((e) => e.kind)).toEqual(['ATTACH', 'DUPLICATE']) // the first copy is kept, the repeat is skipped
    const stored = planImport([inc], [], [event()], new Set(['ev-1']))
    expect(stored.events[0].kind).toBe('DUPLICATE')
  })

  it('never attaches events to a stored report, even an identical one', () => {
    const plan = planImport([inc], [inc], [event()], new Set())
    expect(plan.items[0].kind).toBe('IDENTICAL')
    expect(plan.events[0].kind).toBe('NOT_RESTORED')
  })

  it('a failed restore rolls back incidents and events together', async () => {
    const db = await freshDb()
    await db.put('actionEvents', event({ id: 'ev-1' }))
    await expect(restoreIncidents(db, [incident({ id: 'fresh' })], [event({ id: 'ev-1', incidentId: 'fresh' })])).rejects.toThrow(/no records were added/)
    expect(await db.count('incidents')).toBe(0)
    expect(await db.count('actionEvents')).toBe(1)
    db.close()
  })
})

describe('CSV', () => {
  it('adds a compact completed/total column and leaves existing columns in place', () => {
    expect(CSV_COLUMNS[CSV_COLUMNS.length - 1]).toBe('response_actions_completed')
    expect(CSV_COLUMNS.slice(0, 3)).toEqual(['report_id', 'station_name', 'station_id'])
    const rows = incidentsToCsv([incident()], new Date(NOW), [event()]).split('\r\n')
    expect(rows[1].endsWith(',1/3')).toBe(true)
    expect(incidentsToCsv([incident()], new Date(NOW)).split('\r\n')[1].endsWith(',0/3')).toBe(true)
  })
})
