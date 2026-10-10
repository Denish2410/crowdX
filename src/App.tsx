import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ListFilter,
  LoaderCircle,
  MapPin,
  Radio,
  Send,
  ShieldAlert,
  TramFront,
} from 'lucide-react'
import { corridorById, corridors, metroStations, resolveStation, stationsOnCorridor } from './data/stations'
import type { CorridorId, MetroStation } from './data/stations'
import { createIncident, getIncidents, initialiseIncidents, updateIncident } from './lib/db'
import { ConnectionBadge, PwaNotices } from './components/PwaStatus'
import type { Incident, IncidentStatus, NewIncident, Severity } from './types'

const severityWeight: Record<Severity, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }
const statusWeight: Record<IncidentStatus, number> = { OPEN: 0, ACKNOWLEDGED: 1, RESOLVED: 2 }
const statusStyle: Record<IncidentStatus, string> = {
  OPEN: 'border-red-400/30 bg-red-500/15 text-red-300',
  ACKNOWLEDGED: 'border-amber-300/30 bg-amber-400/15 text-amber-200',
  RESOLVED: 'border-emerald-400/30 bg-emerald-400/15 text-emerald-300',
}
const severityStyle: Record<Severity, string> = {
  CRITICAL: 'text-red-300',
  HIGH: 'text-orange-300',
  MEDIUM: 'text-amber-200',
  LOW: 'text-electric-400',
}

const initialStation = metroStations[0]
const initialForm: NewIncident = {
  station: initialStation.name,
  stationId: initialStation.id,
  zone: initialStation.zones[0],
  severity: 'MEDIUM',
  notes: '',
}

function relativeTime(timestamp: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

function sortIncidents(incidents: Incident[]) {
  return [...incidents].sort((a, b) => {
    const statusDelta = statusWeight[a.status] - statusWeight[b.status]
    if (statusDelta) return statusDelta
    const severityDelta = severityWeight[b.severity] - severityWeight[a.severity]
    if (severityDelta) return severityDelta
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

function App() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<NewIncident>(initialForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [corridorFilter, setCorridorFilter] = useState<CorridorId | 'ALL'>('ALL')
  const [stationFilter, setStationFilter] = useState('ALL')

  const filteredIncidents = useMemo(() => incidents.filter((incident) => {
    const station = resolveStation(incident)
    if (stationFilter !== 'ALL') return station?.id === stationFilter
    if (corridorFilter !== 'ALL') return station?.connectedCorridors.includes(corridorFilter) ?? false
    return true
  }), [incidents, corridorFilter, stationFilter])
  const sortedIncidents = useMemo(() => sortIncidents(filteredIncidents), [filteredIncidents])
  const stationSummary = useMemo(() => {
    const counts = new Map<string, { station: MetroStation; active: number; critical: number }>()
    for (const incident of incidents) {
      if (incident.status === 'RESOLVED') continue
      const station = resolveStation(incident)
      if (!station) continue
      const entry = counts.get(station.id) ?? { station, active: 0, critical: 0 }
      entry.active += 1
      if (incident.severity === 'CRITICAL') entry.critical += 1
      counts.set(station.id, entry)
    }
    return [...counts.values()].sort((a, b) => b.critical - a.critical || b.active - a.active || a.station.name.localeCompare(b.station.name))
  }, [incidents])
  const selected = sortedIncidents.find((incident) => incident.id === selectedId) ?? sortedIncidents[0]
  const activeCount = incidents.filter((incident) => incident.status !== 'RESOLVED').length
  const criticalCount = incidents.filter((incident) => incident.status !== 'RESOLVED' && incident.severity === 'CRITICAL').length
  const resolvedCount = incidents.filter((incident) => incident.status === 'RESOLVED').length

  useEffect(() => {
    async function load() {
      try {
        await initialiseIncidents()
        const stored = await getIncidents()
        setIncidents(stored)
      } catch {
        setError('Local storage could not be opened. Try reloading the dashboard.')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  function updateForm<K extends keyof NewIncident>(key: K, value: NewIncident[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function changeStation(stationId: string) {
    const station = metroStations.find((item) => item.id === stationId) ?? initialStation
    setForm((current) => ({ ...current, station: station.name, stationId: station.id, zone: station.zones[0] }))
  }

  async function submitReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.notes.trim()) {
      setError('Add a short operational note before submitting the report.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const incident = await createIncident({ ...form, notes: form.notes.trim() })
      setIncidents((current) => [...current, incident])
      setSelectedId(incident.id)
      setForm((current) => ({ ...current, notes: '', severity: 'MEDIUM' }))
    } catch {
      setError('The report was not saved locally. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function advanceStatus(incident: Incident) {
    const next: Partial<Record<IncidentStatus, IncidentStatus>> = {
      OPEN: 'ACKNOWLEDGED',
      ACKNOWLEDGED: 'RESOLVED',
    }
    const nextStatus = next[incident.status]
    if (!nextStatus) return

    const now = new Date().toISOString()
    const updated = {
      ...incident,
      status: nextStatus,
      updatedAt: now,
      history: [...incident.history, { status: nextStatus, at: now }],
    }
    try {
      await updateIncident(updated)
      setIncidents((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    } catch {
      setError('The status update was not saved locally. Please try again.')
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(22,135,255,0.14),_transparent_26rem)]">
      <header className="border-b border-white/10 bg-ink-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-electric-500 text-white shadow-lg shadow-electric-500/30"><TramFront size={22} /></div>
            <div>
              <p className="text-lg font-bold tracking-tight text-white">CrowdX</p>
              <p className="text-xs text-slate-400">Ahmedabad Metro · Operations Console</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-electric-400/20 bg-electric-500/10 px-3 py-1.5 text-xs font-medium text-electric-400 sm:flex">
              <Radio size={14} /> Local operations mode
            </div>
            <ConnectionBadge />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-electric-400">Live incident desk</p>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Crowd reporting and response</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Capture station conditions, prioritise the queue, and maintain a clear response history.</p>
          </div>
          <p className="text-xs text-slate-500">Reports are stored on this device and the app works offline.</p>
        </section>

        {error && <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"><AlertTriangle size={17} />{error}</div>}

        <section aria-label="Incident statistics" className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="Active incidents" value={activeCount} icon={<ShieldAlert size={21} />} tone="blue" helper="Open or acknowledged" />
          <StatCard label="Critical attention" value={criticalCount} icon={<AlertTriangle size={21} />} tone="red" helper="Unresolved critical reports" />
          <StatCard label="Resolved incidents" value={resolvedCount} icon={<CheckCircle2 size={21} />} tone="green" helper="Closed on this device" />
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.85fr)]">
          <section className="space-y-6">
            <div className="panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
                <div className="flex items-center gap-2"><ListFilter className="text-electric-400" size={19} /><h2 className="font-semibold text-white">Incident queue</h2></div>
                <span className="text-xs text-slate-400">Unresolved · severity · oldest first</span>
              </div>
              <div className="flex flex-wrap gap-3 border-b border-white/10 px-5 py-3 sm:px-6">
                <label className="text-xs font-medium text-slate-400">Corridor
                  <select value={corridorFilter} onChange={(event) => { setCorridorFilter(event.target.value as CorridorId | 'ALL'); setStationFilter('ALL') }} className="field mt-1 !py-1.5 text-xs">
                    <option value="ALL">All corridors</option>
                    {corridors.map((corridor) => <option key={corridor.id} value={corridor.id}>{corridor.shortName}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-400">Station
                  <select value={stationFilter} onChange={(event) => setStationFilter(event.target.value)} className="field mt-1 !py-1.5 text-xs">
                    <option value="ALL">All stations</option>
                    {(corridorFilter === 'ALL' ? corridors.flatMap((corridor) => stationsOnCorridor(corridor.id)).filter((station, index, all) => all.indexOf(station) === index) : stationsOnCorridor(corridorFilter)).map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
                  </select>
                </label>
                <p className="self-end text-xs text-slate-500">{sortedIncidents.length} of {incidents.length} reports</p>
              </div>
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18} />Opening local incident store…</div>
              ) : (
                <div className="divide-y divide-white/8">
                  {sortedIncidents.length === 0 && <p className="px-6 py-10 text-center text-sm text-slate-500">No reports match this filter.</p>}
                  {sortedIncidents.map((incident) => <IncidentRow key={incident.id} incident={incident} selected={selected?.id === incident.id} onClick={() => setSelectedId(incident.id)} />)}
                </div>
              )}
            </div>

            <div className="panel p-5 sm:p-6">
              <h2 className="font-semibold text-white">Active reports by station</h2>
              {stationSummary.length === 0 ? <p className="mt-3 text-sm text-slate-500">No unresolved reports.</p> : (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {stationSummary.map(({ station, active, critical }) => (
                    <li key={station.id}>
                      <button onClick={() => { setCorridorFilter('ALL'); setStationFilter(station.id) }} className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2 text-left text-sm hover:bg-white/[0.03]">
                        <span className="min-w-0 truncate text-slate-200">{station.name}</span>
                        <span className="shrink-0 text-xs text-slate-400">{active} active{critical > 0 && <span className="ml-1 font-bold text-red-300">· {critical} critical</span>}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {selected && <IncidentDetails incident={selected} onAdvance={() => void advanceStatus(selected)} />}
          </section>

          <aside className="panel h-fit p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-2"><Send className="text-electric-400" size={19} /><div><h2 className="font-semibold text-white">New crowd report</h2><p className="mt-0.5 text-xs text-slate-400">Create an operational incident.</p></div></div>
            <form onSubmit={submitReport} className="space-y-4">
              <label className="block text-sm font-medium text-slate-300">Station
                <select value={form.stationId} onChange={(event) => changeStation(event.target.value)} className="field mt-1.5">
                  {corridors.map((corridor) => (
                    <optgroup key={corridor.id} label={corridor.name}>
                      {metroStations.filter((station) => station.corridorId === corridor.id).sort((a, b) => a.sequence - b.sequence).map((station) => <option key={station.id} value={station.id}>{station.sequence}. {station.name}{station.isInterchange ? ' (interchange → GIFT City branch)' : ''}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-slate-300">Zone
                  <select value={form.zone} onChange={(event) => updateForm('zone', event.target.value)} className="field mt-1.5">
                    {(metroStations.find((station) => station.id === form.stationId)?.zones ?? []).map((zone) => <option key={zone}>{zone}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-300">Severity
                  <select value={form.severity} onChange={(event) => updateForm('severity', event.target.value as Severity)} className="field mt-1.5">
                    {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Severity[]).map((severity) => <option key={severity}>{severity}</option>)}
                  </select>
                </label>
              </div>
              <label className="block text-sm font-medium text-slate-300">Operational notes
                <textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} placeholder="What is happening, and where?" rows={5} className="field mt-1.5 resize-y" />
              </label>
              <button disabled={saving} type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-electric-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-electric-400 disabled:cursor-not-allowed disabled:opacity-60">
                {saving ? <LoaderCircle className="animate-spin" size={17} /> : <Send size={17} />}{saving ? 'Saving report…' : 'Submit crowd report'}
              </button>
            </form>
          </aside>
        </div>
      </div>
      <PwaNotices />
    </main>
  )
}

function StatCard({ label, value, helper, icon, tone }: { label: string; value: number; helper: string; icon: React.ReactNode; tone: 'blue' | 'red' | 'green' }) {
  const toneClasses = { blue: 'bg-electric-500/15 text-electric-400', red: 'bg-red-500/15 text-red-300', green: 'bg-emerald-500/15 text-emerald-300' }
  return <article className="panel flex items-start justify-between p-5"><div><p className="text-sm font-medium text-slate-400">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-white">{value}</p><p className="mt-1 text-xs text-slate-500">{helper}</p></div><div className={`rounded-xl p-2.5 ${toneClasses[tone]}`}>{icon}</div></article>
}

function IncidentRow({ incident, selected, onClick }: { incident: Incident; selected: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`flex w-full items-center gap-3 px-5 py-4 text-left transition sm:px-6 ${selected ? 'bg-electric-500/10' : 'hover:bg-white/[0.03]'}`}>
    <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${incident.severity === 'CRITICAL' ? 'bg-red-400' : incident.severity === 'HIGH' ? 'bg-orange-400' : incident.severity === 'MEDIUM' ? 'bg-amber-300' : 'bg-electric-400'}`} />
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-semibold text-white">{resolveStation(incident)?.name ?? incident.station}</span><span className="text-sm text-slate-400">· {incident.zone}</span><CorridorBadges incident={incident} /></div><p className="mt-1 truncate text-sm text-slate-400">{incident.notes}</p></div>
    <div className="hidden text-right sm:block"><p className={`text-xs font-bold ${severityStyle[incident.severity]}`}>{incident.severity}</p><p className="mt-1 text-xs text-slate-500">{relativeTime(incident.createdAt)}</p></div>
    <span className={`hidden rounded-full border px-2 py-1 text-[10px] font-bold tracking-wide md:inline-block ${statusStyle[incident.status]}`}>{incident.status}</span><ChevronRight className="shrink-0 text-slate-500" size={18} />
  </button>
}

function IncidentDetails({ incident, onAdvance }: { incident: Incident; onAdvance: () => void }) {
  const action = incident.status === 'OPEN' ? 'Acknowledge incident' : incident.status === 'ACKNOWLEDGED' ? 'Resolve incident' : null
  return <article className="panel p-5 sm:p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-electric-400">Selected report</p><h2 className="mt-1 text-xl font-bold text-white">{resolveStation(incident)?.name ?? incident.station} <span className="font-normal text-slate-400">· {incident.zone}</span></h2><div className="mt-2"><CorridorBadges incident={incident} /></div></div><span className={`w-fit rounded-full border px-3 py-1 text-xs font-bold ${statusStyle[incident.status]}`}>{incident.status}</span></div>
    <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_12rem]"><div><p className="text-sm leading-6 text-slate-300">{incident.notes}</p><div className="mt-4 flex items-center gap-2 text-xs text-slate-500"><MapPin size={14} /> Ahmedabad Metro Phase II <span className="text-slate-700">|</span><Clock3 size={14} /> Reported {formatTimestamp(incident.createdAt)}</div>{action && <button onClick={onAdvance} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-electric-400/40 bg-electric-500/10 px-4 py-2.5 text-sm font-semibold text-electric-400 transition hover:bg-electric-500/20">{action}<ArrowRight size={16} /></button>}</div>
      <div className="border-l border-white/10 pl-5"><p className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-slate-500">Status history</p><ol className="space-y-3">{incident.history.map((event, index) => <li key={`${event.status}-${event.at}`} className="relative flex gap-2 text-xs text-slate-400"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${index === incident.history.length - 1 ? 'bg-electric-400' : 'bg-slate-600'}`} /><span><strong className="block text-slate-300">{event.status}</strong>{formatTimestamp(event.at)}</span></li>)}</ol></div>
    </div></article>
}

export default App

function CorridorBadges({ incident }: { incident: Incident }) {
  const station = resolveStation(incident)
  if (!station) return null
  return <>{station.connectedCorridors.map((id) => <span key={id} className="rounded-full border border-electric-400/20 bg-electric-500/10 px-2 py-0.5 text-[10px] font-medium text-electric-400">{corridorById(id).shortName}</span>)}</>
}
