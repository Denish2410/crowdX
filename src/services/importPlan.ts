/** Classifies parsed backup records against what is already stored. Pure: never touches IndexedDB. */
import { validateIncident } from './backupFormat'
import type { Incident } from '../types'

export type PlanKind = 'ADD' | 'IDENTICAL' | 'CONFLICT' | 'FILE_DUPLICATE' | 'FILE_CONFLICT' | 'INVALID'

export interface PlanItem {
  /** Position in the backup file (0-based). */
  index: number
  kind: PlanKind
  id?: string
  incident?: Incident
  errors: string[]
  warnings: string[]
  /** For CONFLICT items: which fields differ from the stored report. */
  differingFields?: string[]
}

export interface ImportPlan {
  items: PlanItem[]
  counts: Record<PlanKind, number> & { total: number }
}

export const kindLabel: Record<PlanKind, string> = {
  ADD: 'New: can be restored',
  IDENTICAL: 'Already exists (identical): skipped',
  CONFLICT: 'Conflict with a stored report: skipped',
  FILE_DUPLICATE: 'Duplicate of an earlier record in the file: skipped',
  FILE_CONFLICT: 'Same ID with different content in the file: skipped',
  INVALID: 'Invalid: skipped',
}

const FIELDS = ['station', 'stationId', 'zone', 'severity', 'notes', 'status', 'createdAt', 'updatedAt', 'history'] as const

export function differingFields(a: Incident, b: Incident): string[] {
  return FIELDS.filter((field) => JSON.stringify(a[field] ?? null) !== JSON.stringify(b[field] ?? null))
}

export function planImport(records: readonly unknown[], existing: readonly Incident[]): ImportPlan {
  const stored = new Map(existing.map((incident) => [incident.id, incident]))
  const items: PlanItem[] = records.map((raw, index) => {
    const result = validateIncident(raw)
    if (!result.incident) {
      const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : undefined
      return { index, kind: 'INVALID' as const, id, errors: result.errors, warnings: result.warnings }
    }
    return { index, kind: 'ADD' as const, id: result.incident.id, incident: result.incident, errors: [], warnings: result.warnings }
  })

  // Same ID more than once inside the file: identical repeats are skipped, differing ones are all held back.
  const byId = new Map<string, PlanItem[]>()
  for (const item of items) {
    if (item.kind !== 'ADD' || !item.id) continue
    byId.set(item.id, [...(byId.get(item.id) ?? []), item])
  }
  for (const group of byId.values()) {
    if (group.length < 2) continue
    const first = group[0].incident!
    const allSame = group.every((item) => differingFields(first, item.incident!).length === 0)
    group.forEach((item, position) => {
      if (allSame && position > 0) item.kind = 'FILE_DUPLICATE'
      else if (!allSame) {
        item.kind = 'FILE_CONFLICT'
        item.errors = [`Another record in this file has the same ID but different content.`]
      }
    })
  }

  // Against the database: identical -> skip, different -> conflict. Existing reports are never overwritten.
  for (const item of items) {
    if (item.kind !== 'ADD') continue
    const current = stored.get(item.id!)
    if (!current) continue
    const diff = differingFields(current, item.incident!)
    if (diff.length === 0) item.kind = 'IDENTICAL'
    else {
      item.kind = 'CONFLICT'
      item.differingFields = diff
    }
  }

  const counts = { ADD: 0, IDENTICAL: 0, CONFLICT: 0, FILE_DUPLICATE: 0, FILE_CONFLICT: 0, INVALID: 0, total: items.length }
  for (const item of items) counts[item.kind] += 1
  return { items, counts }
}
