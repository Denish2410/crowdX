/** CSV export of incident reports. Pure; the caller supplies the reference time used for calculated risk. */
import { corridorById, resolveStation } from '../data/stations'
import { deriveChecklist } from './escalation'
import { scoreIncidents } from './riskScoring'
import type { ActionEvent, Incident } from '../types'

export const CSV_COLUMNS = [
  'report_id', 'station_name', 'station_id', 'corridor', 'zone', 'reported_severity', 'status',
  'calculated_risk_score', 'calculated_risk_band', 'risk_counts_as_active', 'risk_reference_time',
  'notes', 'created_at', 'updated_at', 'resolved_at', 'status_history', 'response_actions_completed',
] as const

/**
 * Escapes one cell. Text beginning with = + - @ (or a tab/CR) is prefixed with an apostrophe so spreadsheets do not
 * evaluate it as a formula; the apostrophe is visible in the data, which is the safe trade-off. Cells containing
 * commas, quotes or line breaks are quoted with internal quotes doubled (RFC 4180).
 */
export function csvCell(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return ''
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const historySummary = (incident: Incident) => incident.history.map((event) => `${event.status}@${event.at}`).join(' > ')

/** Time of the most recent RESOLVED event, if the report has one. */
function resolvedAt(incident: Incident) {
  return [...incident.history].reverse().find((event) => event.status === 'RESOLVED')?.at
}

/** `response_actions_completed` is a compact done/total count; the full action log lives in the JSON backup. Rows are ordered by creation time then ID. Output starts with a UTF-8 BOM so spreadsheet apps detect UTF-8. */
export function incidentsToCsv(incidents: readonly Incident[], referenceTime: Date, actionEvents: readonly ActionEvent[] = []): string {
  const risks = scoreIncidents(incidents, referenceTime)
  const reference = referenceTime.toISOString()
  const sorted = [...incidents].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const lines = [CSV_COLUMNS.join(',')]
  for (const incident of sorted) {
    const station = resolveStation(incident)
    const risk = risks.get(incident.id)
    lines.push([
      incident.id,
      station?.name ?? incident.station,
      incident.stationId,
      station?.connectedCorridors.map((id) => corridorById(id).name).join('; '),
      incident.zone,
      incident.severity,
      incident.status,
      risk?.score,
      risk?.riskBand,
      risk?.eligibleForActive,
      reference,
      incident.notes,
      incident.createdAt,
      incident.updatedAt,
      resolvedAt(incident),
      historySummary(incident),
      (() => { const list = deriveChecklist(incident, actionEvents, referenceTime); return `${list.completedCount}/${list.totalCount}` })(),
    ].map(csvCell).join(','))
  }
  return `﻿${lines.join('\r\n')}\r\n`
}
