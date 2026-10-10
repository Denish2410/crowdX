import { X } from 'lucide-react'
import { corridors, stationsOnCorridor } from '../data/stations'
import type { CorridorId } from '../data/stations'
import { noFilters } from '../lib/incidents'
import type { IncidentFilters } from '../lib/incidents'

export function FilterBar({ filters, onChange, shown, total }: { filters: IncidentFilters; onChange: (filters: IncidentFilters) => void; shown: number; total: number }) {
  const stationOptions =
    filters.corridor === 'ALL'
      ? [...new Map(corridors.flatMap((corridor) => stationsOnCorridor(corridor.id)).map((station) => [station.id, station])).values()]
      : stationsOnCorridor(filters.corridor)
  const active = filters.corridor !== 'ALL' || filters.stationId !== 'ALL'

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-line bg-slate-50/60 px-5 py-3.5 sm:px-6">
      <label className="min-w-36 flex-1 text-xs font-medium text-muted sm:flex-none">
        Corridor
        <select value={filters.corridor} onChange={(e) => onChange({ corridor: e.target.value as CorridorId | 'ALL', stationId: 'ALL' })} className="field mt-1 !py-2">
          <option value="ALL">All corridors</option>
          {corridors.map((corridor) => <option key={corridor.id} value={corridor.id}>{corridor.shortName}</option>)}
        </select>
      </label>
      <label className="min-w-36 flex-1 text-xs font-medium text-muted sm:flex-none">
        Station
        <select value={filters.stationId} onChange={(e) => onChange({ ...filters, stationId: e.target.value })} className="field mt-1 !py-2">
          <option value="ALL">All stations</option>
          {stationOptions.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
        </select>
      </label>
      {active && (
        <button type="button" onClick={() => onChange(noFilters)} className="btn-ghost mb-0.5"><X size={14} />Clear filters</button>
      )}
      <p className="mb-2 ml-auto text-xs text-muted" aria-live="polite">{shown} of {total} reports</p>
    </div>
  )
}
