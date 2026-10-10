import { useMemo, useState } from 'react'
import { ArrowLeftRight, Search, TramFront } from 'lucide-react'
import { corridors, metroStations, stationsOnCorridor } from '../data/stations'
import type { CorridorId, MetroStation } from '../data/stations'
import type { StationCount } from '../lib/incidents'
import { CorridorBadges, EmptyState } from './ui'

type Counts = Map<string, StationCount>

/** Overview panel: stations with unresolved reports, busiest first. */
export function ActiveByStation({ counts, selectedStationId, onSelect }: { counts: Counts; selectedStationId: string; onSelect: (id: string) => void }) {
  const rows = [...counts.values()].sort((a, b) => b.critical - a.critical || b.active - a.active || a.station.name.localeCompare(b.station.name))
  const max = Math.max(1, ...rows.map((row) => row.active))
  return (
    <section className="card" aria-label="Active reports by station">
      <div className="border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">Active reports by station</h2><p className="mt-0.5 text-xs text-muted">Select a station to filter the queue.</p></div>
      {rows.length === 0 ? (
        <EmptyState icon={<TramFront size={20} />} title="No unresolved reports">Every station is clear.</EmptyState>
      ) : (
        <ul className="max-h-96 divide-y divide-line overflow-y-auto">
          {rows.map(({ station, active, critical }) => (
            <li key={station.id}>
              <button type="button" onClick={() => onSelect(station.id)} aria-pressed={selectedStationId === station.id} className={`w-full px-5 py-3 text-left transition-colors hover:bg-slate-50 ${selectedStationId === station.id ? 'bg-tint' : ''}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-ink">{station.name}</span>
                  <span className="shrink-0 text-xs text-muted">{active} active{critical > 0 && <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 font-semibold text-red-700">{critical} critical</span>}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${critical > 0 ? 'bg-red-500' : 'bg-brand-600'}`} style={{ width: `${(active / max) * 100}%` }} /></div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function StationCard({ station, corridor, count, onSelect }: { station: MetroStation; corridor: CorridorId; count?: StationCount; onSelect: (id: string) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onSelect(station.id)} className="card flex w-full items-center gap-3 p-3.5 text-left transition hover:-translate-y-px hover:border-brand-600/40 hover:shadow-lift">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${station.isInterchange ? 'bg-brand-600 text-white' : 'bg-tint text-brand-700'}`}>{station.sequences[corridor]}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink">{station.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <CorridorBadges corridors={station.connectedCorridors} />
            {station.isInterchange && <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"><ArrowLeftRight size={11} />Interchange</span>}
          </span>
        </span>
        <span className="shrink-0 text-right text-xs">
          <span className={`block font-semibold ${count ? 'text-ink' : 'text-slate-400'}`}>{count?.active ?? 0} active</span>
          <span className={`block ${count?.critical ? 'font-semibold text-red-700' : 'text-slate-400'}`}>{count?.critical ?? 0} critical</span>
        </span>
      </button>
    </li>
  )
}

export function StationsView({ counts, onSelectStation }: { counts: Counts; onSelectStation: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [corridorTab, setCorridorTab] = useState<CorridorId | 'ALL'>('ALL')
  const q = query.trim().toLowerCase()

  const sections = useMemo(() => {
    const matches = (s: MetroStation) => !q || [s.name, ...s.aliases].some((label) => label.toLowerCase().includes(q))
    return corridors
      .filter((corridor) => corridorTab === 'ALL' || corridor.id === corridorTab)
      .map((corridor) => ({ corridor, stations: stationsOnCorridor(corridor.id).filter(matches) }))
      .filter((section) => section.stations.length > 0)
  }, [q, corridorTab])

  return (
    <div className="space-y-6">
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stations" aria-label="Search stations" className="field !pl-9" />
        </div>
        <div role="group" aria-label="Corridor" className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {([['ALL', 'All'], ...corridors.map((c) => [c.id, c.shortName])] as [CorridorId | 'ALL', string][]).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={corridorTab === id} onClick={() => setCorridorTab(id)} className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${corridorTab === id ? 'bg-white text-brand-700 shadow-sm' : 'text-muted hover:text-ink'}`}>{label}</button>
          ))}
        </div>
      </div>

      {sections.length === 0 && <div className="card"><EmptyState icon={<Search size={20} />} title="No stations match">Try a different name.</EmptyState></div>}

      {sections.map(({ corridor, stations }) => {
        // GNLU belongs to both corridors but is one station: show it once, in its primary corridor.
        const own = stations.filter((s) => s.corridorId === corridor.id)
        const shared = stations.filter((s) => s.corridorId !== corridor.id)
        return (
          <section key={corridor.id} aria-label={corridor.name}>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <div><h2 className="font-semibold text-ink">{corridor.name}</h2><p className="text-xs text-muted">{corridor.description} · {stationsOnCorridor(corridor.id).length} stations</p></div>
            </div>
            {shared.length > 0 && !q && <p className="mb-3 flex items-center gap-2 rounded-xl border border-blue-200 bg-tint px-3.5 py-2.5 text-xs text-brand-700"><ArrowLeftRight size={14} className="shrink-0" />This branch starts at {shared.map((s) => s.name).join(', ')} (station {shared[0].sequences.MAIN} on the main corridor). Interchange reports are listed under the main corridor.</p>}
            <ul className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
              {own.map((station) => <StationCard key={station.id} station={station} corridor={corridor.id} count={counts.get(station.id)} onSelect={onSelectStation} />)}
            </ul>
          </section>
        )
      })}
      <p className="text-xs text-muted">{metroStations.length} stations in the demonstration dataset. Select a station to see its reports.</p>
    </div>
  )
}
