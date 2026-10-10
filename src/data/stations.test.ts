import { describe, expect, it } from 'vitest'
import { getStationById, metroStations, resolveStation, stationsOnCorridor } from './stations'

const mapLabels = [
  'Motera Stadium', 'Koteshwar Road', 'Vishvakarma College', 'Tapovan Circle', 'Narmada Canal', 'Koba Circle', 'Juna Koba',
  'Koba Gaam', 'GNLU', 'Raysan', 'Randesan', 'Dholakuva Circle', 'Infocity', 'Sector 1', 'Sector 10-A', 'Sachivalaya',
  'Akshardham', 'Juna Sachivalaya', 'Sector 16', 'Sector 24', 'Mahatma Mandir', 'PDPU', 'GIFT City',
]

describe('Ahmedabad Metro Phase II stations', () => {
  it('represents every named map location', () => {
    for (const label of mapLabels) expect(resolveStation({ station: label }), label).toBeDefined()
    expect(metroStations).toHaveLength(mapLabels.length)
  })

  it('has unique IDs, names and sequences per corridor', () => {
    const ids = metroStations.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(metroStations.map((s) => s.name)).size).toBe(metroStations.length)
    for (const id of ['MAIN', 'BRANCH'] as const) {
      const seqs = stationsOnCorridor(id).map((s) => s.sequences[id])
      expect(new Set(seqs).size).toBe(seqs.length)
    }
  })

  it('shares GNLU between both corridors as a single record', () => {
    expect(metroStations.filter((s) => s.name === 'GNLU')).toHaveLength(1)
    const gnlu = getStationById('ST_GNLU')!
    expect(gnlu.isInterchange).toBe(true)
    expect(gnlu.connectedCorridors).toEqual(['MAIN', 'BRANCH'])
  })

  it('orders the main corridor from Motera Stadium to Mahatma Mandir', () => {
    const main = stationsOnCorridor('MAIN')
    expect(main.map((s) => s.name)).toEqual(mapLabels.slice(0, 21))
    expect(main.map((s) => s.sequences.MAIN)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1))
  })

  it('connects GNLU to PDPU/PDEU and GIFT City on the branch', () => {
    expect(stationsOnCorridor('BRANCH').map((s) => s.id)).toEqual(['ST_GNLU', 'ST_PDPU', 'ST_GIFT_CITY'])
    expect(resolveStation({ station: 'PDEU' })?.id).toBe('ST_PDPU')
  })

  it('resolves previously saved reports that have no station ID', () => {
    for (const name of ['Motera Stadium', 'Koteshwar Road', 'Mahatma Mandir', 'GNLU', 'GIFT City']) {
      expect(resolveStation({ station: name })?.name).toBe(name)
    }
    expect(resolveStation({ station: 'Gandhinagar Sector 1' })?.id).toBe('ST_SECTOR_1')
    expect(resolveStation({ station: 'Unknown', stationId: 'ST_GNLU' })?.id).toBe('ST_GNLU')
  })
})
