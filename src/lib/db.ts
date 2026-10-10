import { openCrowdXDb } from './crowdxDb'
import type { Incident, NewIncident } from '../types'

const dbPromise = openCrowdXDb()

/** The shared database handle, for services that need their own transactions (backup restore). */
export const getDb = () => dbPromise

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

const demoIncidents: Incident[] = [
  {
    id: 'demo-motera-critical',
    station: 'Motera Stadium',
    stationId: 'ST_MOTERA_STADIUM',
    zone: 'Platform 1',
    severity: 'CRITICAL',
    notes: 'Heavy post-event crowding. Hold incoming passengers at the concourse until platform clears.',
    status: 'OPEN',
    createdAt: hoursAgo(1.25),
    updatedAt: hoursAgo(1.25),
    history: [{ status: 'OPEN', at: hoursAgo(1.25) }],
  },
  {
    id: 'demo-gnlu-high',
    station: 'GNLU',
    stationId: 'ST_GNLU',
    zone: 'Interchange',
    severity: 'HIGH',
    notes: 'Interchange footfall above normal levels; deploy station volunteers for wayfinding.',
    status: 'ACKNOWLEDGED',
    createdAt: hoursAgo(2.5),
    updatedAt: hoursAgo(1.75),
    history: [
      { status: 'OPEN', at: hoursAgo(2.5) },
      { status: 'ACKNOWLEDGED', at: hoursAgo(1.75) },
    ],
  },
  {
    id: 'demo-gift-city-resolved',
    station: 'GIFT City',
    stationId: 'ST_GIFT_CITY',
    zone: 'Entry Gate',
    severity: 'MEDIUM',
    notes: 'Ticket queue extended to the entry approach during peak hour.',
    status: 'RESOLVED',
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(4.75),
    history: [
      { status: 'OPEN', at: hoursAgo(6) },
      { status: 'ACKNOWLEDGED', at: hoursAgo(5.25) },
      { status: 'RESOLVED', at: hoursAgo(4.75) },
    ],
  },
]

export async function initialiseIncidents() {
  const db = await dbPromise
  const existing = await db.count('incidents')
  if (existing === 0) {
    const transaction = db.transaction('incidents', 'readwrite')
    await Promise.all(demoIncidents.map((incident) => transaction.store.put(incident)))
    await transaction.done
  }
}

export async function getIncidents() {
  return (await dbPromise).getAll('incidents')
}

export async function createIncident(input: NewIncident) {
  const now = new Date().toISOString()
  const incident: Incident = {
    id: crypto.randomUUID(),
    ...input,
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
    history: [{ status: 'OPEN', at: now }],
  }
  await (await dbPromise).put('incidents', incident)
  return incident
}

export async function updateIncident(incident: Incident) {
  await (await dbPromise).put('incidents', incident)
}
