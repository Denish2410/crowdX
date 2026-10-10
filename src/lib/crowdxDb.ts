import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import type { ActionEvent, Incident } from '../types'

export interface CrowdXDatabase extends DBSchema {
  incidents: {
    key: string
    value: Incident
  }
  /** Response-checklist event log (added in database version 2). */
  actionEvents: {
    key: string
    value: ActionEvent
    indexes: { 'by-incident': string }
  }
}

export type CrowdXDb = IDBPDatabase<CrowdXDatabase>

export const DB_NAME = 'crowdx-operations'
/** 1: incidents. 2: adds the actionEvents store. Upgrades are additive; existing stores are never touched. */
export const DB_VERSION = 2

/** Opens the CrowdX database. The schema is the single source of truth for the app and for tests. */
export function openCrowdXDb(name: string = DB_NAME) {
  return openDB<CrowdXDatabase>(name, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) database.createObjectStore('incidents', { keyPath: 'id' })
      if (oldVersion < 2) {
        const events = database.createObjectStore('actionEvents', { keyPath: 'id' })
        events.createIndex('by-incident', 'incidentId')
      }
    },
    // Release the connection if a newer tab needs to upgrade the schema, so the upgrade is not blocked.
    blocking(_current, _blocked, event) {
      ;(event.target as IDBDatabase).close()
    },
  })
}
