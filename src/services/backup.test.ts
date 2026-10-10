import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { metroStations } from '../data/stations'
import { openCrowdXDb } from '../lib/crowdxDb'
import type { Incident } from '../types'
import { BACKUP_SCHEMA_VERSION, backupFilename, createBackup, parseBackup, validateIncident } from './backupFormat'
import { readAllIncidents, restoreIncidents, RestoreError } from './backupRestore'
import { csvCell, CSV_COLUMNS, incidentsToCsv } from './csvExport'
import { planImport } from './importPlan'

const EXPORTED_AT = new Date('2026-10-10T12:00:00.000Z')

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'inc-1',
    station: 'GNLU',
    stationId: 'ST_GNLU',
    zone: 'Interchange',
    severity: 'HIGH',
    notes: 'Crowded concourse',
    status: 'OPEN',
    createdAt: '2026-10-10T11:00:00.000Z',
    updatedAt: '2026-10-10T11:00:00.000Z',
    history: [{ status: 'OPEN', at: '2026-10-10T11:00:00.000Z' }],
    ...overrides,
  }
}

const resolved = incident({
  id: 'inc-2', station: 'GIFT City', stationId: 'ST_GIFT_CITY', zone: 'Entry Gate', severity: 'MEDIUM', status: 'RESOLVED',
  updatedAt: '2026-10-10T10:30:00.000Z', createdAt: '2026-10-10T09:00:00.000Z',
  history: [{ status: 'OPEN', at: '2026-10-10T09:00:00.000Z' }, { status: 'ACKNOWLEDGED', at: '2026-10-10T09:30:00.000Z' }, { status: 'RESOLVED', at: '2026-10-10T10:30:00.000Z' }],
})

let dbCounter = 0
const freshDb = () => openCrowdXDb(`test-db-${(dbCounter += 1)}`)
const roundTrip = (backup: unknown) => parseBackup(JSON.stringify(backup))

describe('backup format', () => {
  it('serialises the documented envelope deterministically', () => {
    const backup = createBackup([resolved, incident()], EXPORTED_AT)
    expect(backup).toMatchObject({ app: 'CrowdX', schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: '2026-10-10T12:00:00.000Z' })
    expect(backup.stationDataset.stationCount).toBe(23)
    expect(backup.incidents.map((i) => i.id)).toEqual(['inc-2', 'inc-1']) // by createdAt
    expect(JSON.stringify(createBackup([incident(), resolved], EXPORTED_AT))).toBe(JSON.stringify(backup))
    expect(JSON.stringify(backup)).not.toMatch(/riskScore|"score"/) // derived values are not stored
  })

  it('names files by date', () => {
    expect(backupFilename(EXPORTED_AT, 'json')).toBe('crowdx-backup-2026-10-10.json')
    expect(backupFilename(EXPORTED_AT, 'csv', 'crowdx-reports')).toBe('crowdx-reports-2026-10-10.csv')
  })

  it('exports an empty database as a valid empty backup', () => {
    const parsed = roundTrip(createBackup([], EXPORTED_AT))
    expect(parsed).toMatchObject({ ok: true, records: [] })
  })

  it('does not change the 23-station dataset', () => {
    expect(metroStations).toHaveLength(23)
  })
})

describe('envelope validation', () => {
  const base = () => createBackup([incident()], EXPORTED_AT)

  it('rejects invalid JSON, non-objects and other apps', () => {
    expect(parseBackup('{nope')).toMatchObject({ ok: false, error: expect.stringContaining('not valid JSON') })
    expect(parseBackup('[]')).toMatchObject({ ok: false })
    expect(roundTrip({ ...base(), app: 'Other' })).toMatchObject({ ok: false, error: expect.stringContaining('not a CrowdX backup') })
  })

  it('rejects unsupported future and invalid schema versions', () => {
    expect(roundTrip({ ...base(), schemaVersion: BACKUP_SCHEMA_VERSION + 1 })).toMatchObject({ ok: false, error: expect.stringContaining('newer') })
    for (const schemaVersion of [0, -1, 1.5, '1', null, undefined]) expect(roundTrip({ ...base(), schemaVersion })).toMatchObject({ ok: false })
  })

  it('rejects a missing exportedAt or incidents array', () => {
    expect(roundTrip({ ...base(), exportedAt: 'yesterday' })).toMatchObject({ ok: false })
    expect(roundTrip({ ...base(), incidents: {} })).toMatchObject({ ok: false })
  })

  it('accepts a UTF-8 BOM', () => {
    expect(parseBackup(`﻿${JSON.stringify(base())}`)).toMatchObject({ ok: true })
  })
})

describe('record validation', () => {
  it('accepts a good record unchanged', () => {
    expect(validateIncident(incident())).toMatchObject({ incident: incident(), errors: [] })
  })

  it.each([
    ['missing id', { id: undefined }],
    ['empty id', { id: '  ' }],
    ['bad severity', { severity: 'EXTREME' }],
    ['lowercase status', { status: 'open' }],
    ['numeric notes', { notes: 5 }],
    ['missing zone', { zone: undefined }],
    ['invalid createdAt', { createdAt: 'yesterday' }],
    ['date-only updatedAt', { updatedAt: '2026-10-10' }],
    ['non-array history', { history: 'OPEN' }],
    ['empty history', { history: [] }],
    ['malformed history event', { history: [{ status: 'NOPE', at: '2026-10-10T11:00:00.000Z' }] }],
    ['history timestamp invalid', { history: [{ status: 'OPEN', at: 'x' }] }],
    ['history not ending at current status', { status: 'RESOLVED' }],
    ['history out of order', { status: 'ACKNOWLEDGED', history: [{ status: 'OPEN', at: '2026-10-10T11:00:00.000Z' }, { status: 'ACKNOWLEDGED', at: '2026-10-10T10:00:00.000Z' }] }],
    ['unknown station', { station: 'Atlantis', stationId: undefined }],
    ['unknown stationId', { stationId: 'ST_NOPE' }],
    ['non-string stationId', { stationId: 7 as unknown as string }],
  ])('rejects %s', (_label, overrides) => {
    const result = validateIncident({ ...incident(), ...overrides })
    expect(result.incident).toBeUndefined()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects non-objects', () => {
    for (const value of [null, 3, 'x', [], undefined]) expect(validateIncident(value).incident).toBeUndefined()
  })

  it('resolves legacy station names and aliases, noting it', () => {
    const legacy = validateIncident({ ...incident(), station: 'Gandhinagar Sector 1', stationId: undefined })
    expect(legacy.incident?.stationId).toBe('ST_SECTOR_1')
    expect(legacy.incident?.station).toBe('Gandhinagar Sector 1') // original name preserved
    expect(legacy.warnings.join(' ')).toMatch(/resolved to Sector 1/)
    expect(validateIncident({ ...incident(), station: 'PDEU', stationId: undefined }).incident?.stationId).toBe('ST_PDPU')
  })

  it('does not copy unknown fields, and says so', () => {
    const result = validateIncident({ ...incident(), riskScore: 99, __proto__x: 1 })
    expect(result.incident).not.toHaveProperty('riskScore')
    expect(result.warnings.join(' ')).toMatch(/riskScore/)
  })

  it('preserves unicode text', () => {
    expect(validateIncident(incident({ notes: 'ભીડ ઘણી વધારે 🚇', zone: 'Concourse' })).incident?.notes).toBe('ભીડ ઘણી વધારે 🚇')
  })

  it('does not treat a malicious __proto__ key as data', () => {
    const parsed = JSON.parse('{"__proto__":{"status":"RESOLVED"},"id":"a"}')
    expect(validateIncident(parsed).incident).toBeUndefined()
  })
})

describe('import plan', () => {
  it('imports only valid records when others are invalid', () => {
    const plan = planImport([incident({ id: 'ok' }), { id: 'bad', severity: 'X' }, 'junk'], [])
    expect(plan.counts).toMatchObject({ ADD: 1, INVALID: 2, total: 3 })
    expect(plan.items.filter((i) => i.kind === 'ADD').map((i) => i.id)).toEqual(['ok'])
  })

  it('skips identical stored records and flags conflicts without overwriting', () => {
    const stored = [incident({ id: 'same' }), incident({ id: 'diff', notes: 'original' })]
    const plan = planImport([incident({ id: 'same' }), incident({ id: 'diff', notes: 'changed', status: 'RESOLVED', history: [{ status: 'RESOLVED', at: '2026-10-10T11:00:00.000Z' }] }), incident({ id: 'new' })], stored)
    expect(plan.items.map((i) => i.kind)).toEqual(['IDENTICAL', 'CONFLICT', 'ADD'])
    expect(plan.items[1].differingFields).toEqual(expect.arrayContaining(['notes', 'status']))
  })

  it('detects duplicate IDs inside the file', () => {
    const same = planImport([incident({ id: 'd' }), incident({ id: 'd' })], [])
    expect(same.items.map((i) => i.kind)).toEqual(['ADD', 'FILE_DUPLICATE'])
    const differing = planImport([incident({ id: 'd' }), incident({ id: 'd', notes: 'other' })], [])
    expect(differing.items.map((i) => i.kind)).toEqual(['FILE_CONFLICT', 'FILE_CONFLICT'])
    expect(differing.counts.ADD).toBe(0)
  })

  it('treats a station reference resolved from an alias as the same record when otherwise equal', () => {
    const stored = [incident({ id: 'x', station: 'Sector 1', stationId: 'ST_SECTOR_1' })]
    const plan = planImport([incident({ id: 'x', station: 'Sector 1', stationId: undefined })], stored)
    expect(plan.items[0].kind).toBe('IDENTICAL')
  })
})

describe('transactional restore (fake IndexedDB)', () => {
  it('round-trips a backup into an empty database', async () => {
    const source = [incident(), resolved]
    const parsed = roundTrip(createBackup(source, EXPORTED_AT))
    if (!parsed.ok) throw new Error('parse failed')
    const plan = planImport(parsed.records, [])
    const db = await freshDb()
    const result = await restoreIncidents(db, plan.items.filter((i) => i.kind === 'ADD').map((i) => i.incident!))
    expect(result.added).toBe(2)
    const stored = await readAllIncidents(db)
    expect(stored.sort((a, b) => a.id.localeCompare(b.id))).toEqual(source)
    db.close()
  })

  it('is additive: existing reports and their history are untouched', async () => {
    const db = await freshDb()
    const original = incident({ id: 'keep', notes: 'original' })
    await db.put('incidents', original)
    await restoreIncidents(db, [incident({ id: 'new' })])
    expect(await db.get('incidents', 'keep')).toEqual(original)
    expect(await db.count('incidents')).toBe(2)
    db.close()
  })

  it('never overwrites: a colliding ID rolls back the whole batch and is not reported as success', async () => {
    const db = await freshDb()
    const original = incident({ id: 'clash', notes: 'original' })
    await db.put('incidents', original)
    await expect(restoreIncidents(db, [incident({ id: 'first' }), incident({ id: 'clash', notes: 'attacker' }), incident({ id: 'third' })])).rejects.toBeInstanceOf(RestoreError)
    expect(await db.get('incidents', 'clash')).toEqual(original)
    expect(await db.get('incidents', 'first')).toBeUndefined() // rolled back
    expect(await db.get('incidents', 'third')).toBeUndefined()
    expect(await db.count('incidents')).toBe(1)
    db.close()
  })

  it('fails without success when the same ID appears twice in a batch', async () => {
    const db = await freshDb()
    await expect(restoreIncidents(db, [incident({ id: 'dup' }), incident({ id: 'dup' })])).rejects.toBeInstanceOf(RestoreError)
    expect(await db.count('incidents')).toBe(0)
    db.close()
  })

  it('restoring nothing is a no-op', async () => {
    const db = await freshDb()
    expect(await restoreIncidents(db, [])).toEqual({ added: 0 })
    db.close()
  })

  it('restored reports are readable after reopening the database (reload)', async () => {
    const name = `reload-${(dbCounter += 1)}`
    const first = await openCrowdXDb(name)
    await restoreIncidents(first, [incident({ id: 'persist' })])
    first.close()
    const second = await openCrowdXDb(name)
    expect((await readAllIncidents(second)).map((i) => i.id)).toEqual(['persist'])
    second.close()
  })
})

describe('CSV export', () => {
  it('escapes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"')
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(0)).toBe('0')
    expect(csvCell(false)).toBe('false')
  })

  it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\tx', '=HYPERLINK("http://x","y")'])('neutralises formula %j', (text) => {
    expect(csvCell(text).replace(/^"/, '')).toMatch(/^'/)
  })

  it('does not alter numbers or ordinary text containing those characters mid-string', () => {
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell('a=b')).toBe('a=b')
  })

  const NOW = new Date('2026-10-10T12:00:00.000Z')

  it('produces the documented header, BOM and CRLF rows', () => {
    const csv = incidentsToCsv([incident(), resolved], NOW)
    expect(csv.startsWith('﻿' + CSV_COLUMNS.join(','))).toBe(true)
    expect(csv.split('\r\n')).toHaveLength(4) // header + 2 rows + trailing newline
  })

  it('exports an empty database as a header-only file', () => {
    expect(incidentsToCsv([], NOW)).toBe(`﻿${CSV_COLUMNS.join(',')}\r\n`)
  })

  it('includes risk from the scoring service at the documented reference time, resolution time and history', () => {
    const rows = incidentsToCsv([incident(), resolved], NOW).split('\r\n')
    const [gift, gnlu] = [rows[1], rows[2]] // sorted by createdAt: resolved (09:00) first
    expect(gift).toContain('inc-2,GIFT City,ST_GIFT_CITY,')
    expect(gift).toContain('2026-10-10T10:30:00.000Z,OPEN@2026-10-10T09:00:00.000Z > ACKNOWLEDGED@2026-10-10T09:30:00.000Z > RESOLVED@2026-10-10T10:30:00.000Z')
    expect(gift).toContain(',20,LOW,false,2026-10-10T12:00:00.000Z,') // resolved: severity points only, not active
    // GNLU HIGH, open 60 min: 30 + 30 + 0 = 60 -> HIGH, active
    expect(gnlu).toContain(',60,HIGH,true,2026-10-10T12:00:00.000Z,')
    expect(gnlu).toContain('Motera Stadium – Mahatma Mandir; GNLU – GIFT City')
  })

  it('does not fabricate station IDs or resolution times', () => {
    const legacy = incident({ id: 'legacy', station: 'Gandhinagar Sector 1', stationId: undefined })
    const row = incidentsToCsv([legacy], NOW).split('\r\n')[1]
    expect(row.startsWith('legacy,Sector 1,,')).toBe(true) // station_id left blank
    expect(row).toMatch(/,2026-10-10T11:00:00.000Z,2026-10-10T11:00:00.000Z,,OPEN@/) // resolved_at blank
  })

  it('keeps unicode, quotes injection and newlines in notes intact', () => {
    const csv = incidentsToCsv([incident({ notes: '=cmd|"x", ગુજરાતી 🚇\nnext' })], NOW)
    expect(csv).toContain(`"'=cmd|""x"", ગુજરાતી 🚇\nnext"`)
  })
})
