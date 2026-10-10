import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import type { Incident } from '../types'

export interface CrowdXDatabase extends DBSchema {
  incidents: {
    key: string
    value: Incident
  }
}

export type CrowdXDb = IDBPDatabase<CrowdXDatabase>

export const DB_NAME = 'crowdx-operations'
export const DB_VERSION = 1

/** Opens the CrowdX database. The schema is the single source of truth for the app and for tests. */
export function openCrowdXDb(name: string = DB_NAME) {
  return openDB<CrowdXDatabase>(name, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore('incidents', { keyPath: 'id' })
    },
  })
}
