/**
 * CrowdX JSON backup format (schemaVersion 1)
 *
 * {
 *   "app": "CrowdX",
 *   "schemaVersion": 1,
 *   "exportedAt": "<ISO 8601>",
 *   "stationDataset": { "stationCount": 23, "stationIds": ["ST_..."] },   // informational metadata only
 *   "incidents": [ Incident, ... ]                                       // every record in the `incidents` store
 * }
 *
 * `incidents` holds the app's own Incident objects unchanged (id, station, stationId?, zone, severity, notes, status,
 * createdAt, updatedAt, history[]). The `incidents` store is the only persisted application data, so nothing else is
 * exported. Calculated risk scores are deliberately NOT stored: they are derived values and are recomputed from the
 * restored reports. Newer schema versions are rejected rather than guessed at.
 */
import { metroStations, resolveStation } from '../data/stations'
import { severities, statuses } from '../types'
import type { Incident, StatusEvent } from '../types'

export const BACKUP_APP_ID = 'CrowdX'
export const BACKUP_SCHEMA_VERSION = 1
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024

export interface CrowdXBackup {
  app: typeof BACKUP_APP_ID
  schemaVersion: number
  exportedAt: string
  stationDataset: { stationCount: number; stationIds: string[] }
  incidents: Incident[]
}

/** Serialises incidents into the backup format. Sorted by creation time then ID so output is deterministic. */
export function createBackup(incidents: readonly Incident[], exportedAt: Date): CrowdXBackup {
  const sorted = [...incidents].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    stationDataset: { stationCount: metroStations.length, stationIds: metroStations.map((station) => station.id) },
    incidents: sorted,
  }
}

export function backupFilename(date: Date, extension: 'json' | 'csv', prefix = 'crowdx-backup') {
  return `${prefix}-${date.toISOString().slice(0, 10)}.${extension}`
}

// ---------------------------------------------------------------------------------------------------------------
// Validation

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/
const KNOWN_FIELDS = new Set(['id', 'station', 'stationId', 'zone', 'severity', 'notes', 'status', 'createdAt', 'updatedAt', 'history'])
const MAX_TEXT = 10_000

export const isIsoTimestamp = (value: unknown): value is string => typeof value === 'string' && ISO_8601.test(value) && Number.isFinite(Date.parse(value))
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export interface RecordValidation {
  incident?: Incident
  errors: string[]
  warnings: string[]
}

/** Strictly validates one imported record. Never coerces: any malformed field makes the record invalid. */
export function validateIncident(raw: unknown): RecordValidation {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isRecord(raw)) return { errors: ['Record is not an object.'], warnings }

  const text = (key: string, { allowEmpty = false } = {}) => {
    const value = raw[key]
    if (typeof value !== 'string') errors.push(`"${key}" must be a string.`)
    else if (!allowEmpty && value.trim() === '') errors.push(`"${key}" must not be empty.`)
    else if (value.length > MAX_TEXT) errors.push(`"${key}" is longer than ${MAX_TEXT} characters.`)
    return typeof value === 'string' ? value : ''
  }

  const id = text('id')
  const station = text('station')
  const zone = text('zone')
  const notes = text('notes', { allowEmpty: true })

  const severity = raw.severity
  if (!(severities as readonly unknown[]).includes(severity)) errors.push(`"severity" must be one of ${severities.join(', ')}.`)
  const status = raw.status
  if (!(statuses as readonly unknown[]).includes(status)) errors.push(`"status" must be one of ${statuses.join(', ')}.`)

  if (!isIsoTimestamp(raw.createdAt)) errors.push('"createdAt" must be an ISO 8601 timestamp.')
  if (!isIsoTimestamp(raw.updatedAt)) errors.push('"updatedAt" must be an ISO 8601 timestamp.')

  // History: array of {status, at}, chronological, ending at the current status.
  const history: StatusEvent[] = []
  if (!Array.isArray(raw.history) || raw.history.length === 0) {
    errors.push('"history" must be a non-empty array.')
  } else {
    raw.history.forEach((event: unknown, index) => {
      if (!isRecord(event) || !(statuses as readonly unknown[]).includes(event.status) || !isIsoTimestamp(event.at)) {
        errors.push(`"history[${index}]" must be { status, at } with a valid status and ISO 8601 timestamp.`)
      } else {
        history.push({ status: event.status as StatusEvent['status'], at: event.at })
      }
    })
    if (history.length === raw.history.length) {
      for (let i = 1; i < history.length; i += 1) {
        if (Date.parse(history[i].at) < Date.parse(history[i - 1].at)) {
          errors.push('"history" must be in chronological order.')
          break
        }
      }
      if (history[history.length - 1].status !== status) errors.push('"history" must end with the current status.')
    }
  }

  // Station reference: stationId wins; legacy records resolve through the station name or alias.
  let stationId: string | undefined
  if (raw.stationId !== undefined && typeof raw.stationId !== 'string') {
    errors.push('"stationId" must be a string when present.')
  } else if (typeof raw.stationId === 'string' && station) {
    const resolved = resolveStation({ stationId: raw.stationId, station })
    const byId = metroStations.find((s) => s.id === raw.stationId)
    if (!byId) errors.push(`Unknown stationId "${raw.stationId}".`)
    else {
      stationId = byId.id
      if (resolved && resolved.id !== byId.id) warnings.push(`Station name "${station}" does not match ${byId.name}; the stationId was kept.`)
    }
  } else if (station) {
    const resolved = resolveStation({ station })
    if (!resolved) errors.push(`Unknown station "${station}".`)
    else {
      stationId = resolved.id
      warnings.push(`Legacy station "${station}" resolved to ${resolved.name} (${resolved.id}).`)
    }
  }

  const resolvedStation = stationId ? metroStations.find((s) => s.id === stationId) : undefined
  if (resolvedStation && zone && !resolvedStation.zones.includes(zone)) warnings.push(`Zone "${zone}" is not a standard zone for ${resolvedStation.name}.`)

  const ignored = Object.keys(raw).filter((key) => !KNOWN_FIELDS.has(key))
  if (ignored.length > 0) warnings.push(`Ignored unknown field${ignored.length > 1 ? 's' : ''}: ${ignored.join(', ')}.`)

  if (errors.length > 0) return { errors, warnings }
  return {
    incident: { id, station, stationId, zone, severity: severity as Incident['severity'], notes, status: status as Incident['status'], createdAt: raw.createdAt as string, updatedAt: raw.updatedAt as string, history },
    errors,
    warnings,
  }
}

export type ParsedBackup =
  | { ok: false; error: string }
  | { ok: true; exportedAt: string; schemaVersion: number; records: unknown[] }

/** Parses and checks the envelope only; individual records are validated by validateIncident. */
export function parseBackup(text: string): ParsedBackup {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: 'This file is larger than 25 MB and was not read.' }
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' }
  }
  if (!isRecord(data)) return { ok: false, error: 'This file is not a CrowdX backup (expected a JSON object).' }
  if (data.app !== BACKUP_APP_ID) return { ok: false, error: 'This file is not a CrowdX backup (missing or wrong "app" identifier).' }
  const version = data.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, error: 'The backup has no valid "schemaVersion".' }
  if (version > BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: `This backup uses schema version ${version}, which is newer than this version of CrowdX supports (${BACKUP_SCHEMA_VERSION}). Update CrowdX and try again.` }
  }
  if (!isIsoTimestamp(data.exportedAt)) return { ok: false, error: 'The backup has no valid "exportedAt" timestamp.' }
  if (!Array.isArray(data.incidents)) return { ok: false, error: 'The backup has no "incidents" array.' }
  return { ok: true, exportedAt: data.exportedAt, schemaVersion: version, records: data.incidents }
}
