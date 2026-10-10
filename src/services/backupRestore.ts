/** Additive, transactional restore. Existing reports are never overwritten, replaced or deleted. */
import type { CrowdXDb } from '../lib/crowdxDb'
import type { ActionEvent, Incident } from '../types'

export async function readAllIncidents(db: CrowdXDb): Promise<Incident[]> {
  return db.getAll('incidents')
}

export class RestoreError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'RestoreError'
  }
}

/**
 * Adds the given reports (and their checklist events) in a single readwrite transaction. `add` (not `put`) is used so an ID that already exists
 * makes that request fail, which aborts the whole transaction: either every record is stored or none is.
 * Resolves only after the transaction has completed, so callers can report success truthfully.
 */
export async function restoreIncidents(db: CrowdXDb, incidents: readonly Incident[], events: readonly ActionEvent[] = []): Promise<{ added: number; eventsAdded: number }> {
  if (incidents.length === 0) return { added: 0, eventsAdded: 0 }
  const tx = db.transaction(['incidents', 'actionEvents'], 'readwrite')
  try {
    const reports = tx.objectStore('incidents')
    const log = tx.objectStore('actionEvents')
    await Promise.all([...incidents.map((incident) => reports.add(incident)), ...events.map((event) => log.add(event)), tx.done])
  } catch (error) {
    try { tx.abort() } catch { /* already finished or aborted */ }
    const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
    throw new RestoreError(`The restore failed and no records were added${detail}.`, error)
  }
  return { added: incidents.length, eventsAdded: events.length }
}
