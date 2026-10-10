// Ahmedabad Metro Phase II station data (demonstration dataset).
// Source: route map supplied for CrowdX. Verify against official GMRC data before operational use.

export type CorridorId = 'MAIN' | 'BRANCH'

export interface Corridor {
  id: CorridorId
  name: string
  /** Short label for badges. */
  shortName: string
  description: string
}

export interface MetroStation {
  id: string
  name: string
  aliases: string[]
  /** Corridor the station primarily belongs to. */
  corridorId: CorridorId
  /** Position (1-based, south to north / towards GIFT City) on the primary corridor. */
  sequence: number
  /** Position on every corridor the station serves. */
  sequences: Partial<Record<CorridorId, number>>
  isInterchange: boolean
  /** Every corridor serving the station (includes corridorId). */
  connectedCorridors: CorridorId[]
  zones: string[]
}

export const corridors: Corridor[] = [
  { id: 'MAIN', name: 'Motera Stadium – Mahatma Mandir', shortName: 'Main corridor', description: 'Main corridor, south to north' },
  { id: 'BRANCH', name: 'GNLU – GIFT City', shortName: 'GIFT City branch', description: 'Branch from GNLU' },
]

const baseZones = ['Concourse', 'Platform 1', 'Platform 2', 'Entry Gate', 'Exit Gate']
const interchangeZones = ['Concourse', 'Interchange', 'Platform 1', 'Platform 2', 'Platform 3', 'Entry Gate', 'Exit Gate']

function main(sequence: number, id: string, name: string, aliases: string[] = []): MetroStation {
  return { id: `ST_${id}`, name, aliases, corridorId: 'MAIN', sequence, sequences: { MAIN: sequence }, isInterchange: false, connectedCorridors: ['MAIN'], zones: baseZones }
}

function branch(sequence: number, id: string, name: string, aliases: string[] = []): MetroStation {
  return { id: `ST_${id}`, name, aliases, corridorId: 'BRANCH', sequence, sequences: { BRANCH: sequence }, isInterchange: false, connectedCorridors: ['BRANCH'], zones: baseZones }
}

export const metroStations: MetroStation[] = [
  main(1, 'MOTERA_STADIUM', 'Motera Stadium'),
  main(2, 'KOTESHWAR_ROAD', 'Koteshwar Road'),
  main(3, 'VISHVAKARMA_COLLEGE', 'Vishvakarma College', ['Vishwakarma College']),
  main(4, 'TAPOVAN_CIRCLE', 'Tapovan Circle'),
  main(5, 'NARMADA_CANAL', 'Narmada Canal'),
  main(6, 'KOBA_CIRCLE', 'Koba Circle'),
  main(7, 'JUNA_KOBA', 'Juna Koba'),
  main(8, 'KOBA_GAAM', 'Koba Gaam', ['Koba Gam']),
  {
    // Shared station: one record serving both corridors.
    id: 'ST_GNLU',
    name: 'GNLU',
    aliases: ['Gujarat National Law University'],
    corridorId: 'MAIN',
    sequence: 9,
    sequences: { MAIN: 9, BRANCH: 1 },
    isInterchange: true,
    connectedCorridors: ['MAIN', 'BRANCH'],
    zones: interchangeZones,
  },
  main(10, 'RAYSAN', 'Raysan'),
  main(11, 'RANDESAN', 'Randesan'),
  main(12, 'DHOLAKUVA_CIRCLE', 'Dholakuva Circle'),
  main(13, 'INFOCITY', 'Infocity'),
  // 'Gandhinagar Sector 1' is the name used by earlier CrowdX builds.
  main(14, 'SECTOR_1', 'Sector 1', ['Gandhinagar Sector 1']),
  main(15, 'SECTOR_10_A', 'Sector 10-A', ['Sector 10A']),
  main(16, 'SACHIVALAYA', 'Sachivalaya'),
  main(17, 'AKSHARDHAM', 'Akshardham'),
  main(18, 'JUNA_SACHIVALAYA', 'Juna Sachivalaya', ['Old Sachivalaya']),
  main(19, 'SECTOR_16', 'Sector 16'),
  main(20, 'SECTOR_24', 'Sector 24'),
  main(21, 'MAHATMA_MANDIR', 'Mahatma Mandir'),
  branch(2, 'PDPU', 'PDPU', ['PDEU', 'Pandit Deendayal Energy University', 'Pandit Deendayal Petroleum University']),
  branch(3, 'GIFT_CITY', 'GIFT City', ['Gujarat International Finance Tec-City']),
]

const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

const byId = new Map(metroStations.map((station) => [station.id, station]))
const byName = new Map<string, MetroStation>()
for (const station of metroStations) {
  for (const label of [station.name, ...station.aliases]) byName.set(normalise(label), station)
}

export const corridorById = (id: CorridorId) => corridors.find((corridor) => corridor.id === id)!

export function stationsOnCorridor(id: CorridorId) {
  return metroStations
    .filter((station) => station.connectedCorridors.includes(id))
    .sort((a, b) => (a.sequences[id] ?? 0) - (b.sequences[id] ?? 0))
}

/** Resolves a saved report to a station by ID, then by name/alias (reports saved before station IDs existed). */
export function resolveStation(ref: { stationId?: string; station: string }): MetroStation | undefined {
  return (ref.stationId ? byId.get(ref.stationId) : undefined) ?? byName.get(normalise(ref.station))
}

export const getStationById = (id: string) => byId.get(id)
