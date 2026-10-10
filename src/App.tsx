import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, ListFilter, LoaderCircle, Send, ShieldAlert, Siren, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { resolveStation } from './data/stations'
import { createIncident, getIncidents, initialiseIncidents, updateIncident } from './lib/db'
import { filterIncidents, nextStatus, noFilters, sortIncidents } from './lib/incidents'
import type { IncidentFilters } from './lib/incidents'
import { scoreIncidents } from './services/riskScoring'
import { summariseRisk, summariseStationRisk } from './services/riskSummary'
import type { Incident } from './types'
import { AppShell } from './components/AppShell'
import type { View } from './components/AppShell'
import { FilterBar } from './components/FilterBar'
import { IncidentDetails, IncidentList } from './components/IncidentQueue'
import { PwaNotices } from './components/PwaStatus'
import { initialDraft, ReportForm } from './components/ReportForm'
import type { ReportDraft } from './components/ReportForm'
import { RiskOverviewCard } from './components/RiskViews'
import { ActiveByStation, StationsView } from './components/StationViews'

const pageText: Record<View, { title: string; subtitle: (active: number, critical: number) => string }> = {
  overview: {
    title: 'Metro Operations Overview',
    subtitle: (active, critical) =>
      active === 0 ? 'All clear: there are no unresolved crowd reports.' : `${active} unresolved crowd ${active === 1 ? 'report' : 'reports'}${critical ? `, ${critical} critical` : ''}. Reports are saved on this device.`,
  },
  reports: { title: 'Crowd Reports', subtitle: () => 'File a new crowd report and work through the priority queue.' },
  stations: { title: 'Stations', subtitle: () => 'Ahmedabad Metro Phase II stations by corridor, with unresolved report counts.' },
}

const QUEUE_PREVIEW = 6

function StatCard({ label, value, helper, icon, tone }: { label: string; value: number; helper: string; icon: ReactNode; tone: string }) {
  return (
    <article className="card flex items-start justify-between p-5">
      <div><p className="text-sm font-medium text-muted">{label}</p><p className="mt-2 text-4xl font-bold tracking-tight text-ink tabular-nums">{value}</p><p className="mt-1 text-xs text-muted">{helper}</p></div>
      <div className={`rounded-xl p-2.5 ${tone}`}>{icon}</div>
    </article>
  )
}

function App() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [view, setView] = useState<View>('overview')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<IncidentFilters>(noFilters)
  const [draft, setDraft] = useState<ReportDraft>(initialDraft)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [validation, setValidation] = useState('')
  const [saveError, setSaveError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    async function load() {
      try {
        await initialiseIncidents()
        setIncidents(await getIncidents())
      } catch {
        setLoadError('Local storage could not be opened. Try reloading the dashboard.')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  useEffect(() => {
    if (!success) return
    const timer = window.setTimeout(() => setSuccess(''), 6000)
    return () => window.clearTimeout(timer)
  }, [success])

  // Reference time for age-based scores. The timer only changes state when the wall-clock minute changes, so
  // scores refresh about once a minute; creating a report also refreshes it so the new report counts immediately.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      const current = Date.now()
      setNow((previous) => (Math.floor(current / 60000) !== Math.floor(previous / 60000) ? current : previous))
    }
    const timer = window.setInterval(tick, 15000)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [])

  // Scores are always derived from the loaded reports and the reference time; nothing is stored.
  const risks = useMemo(() => scoreIncidents(incidents, now), [incidents, now])
  const riskOverview = useMemo(() => summariseRisk(incidents, risks), [incidents, risks])
  const counts = useMemo(() => new Map(summariseStationRisk(incidents, risks).map((entry) => [entry.station.id, entry])), [incidents, risks])
  const filtered = useMemo(() => sortIncidents(filterIncidents(incidents, filters), risks), [incidents, filters, risks])
  const selected = filtered.find((incident) => incident.id === selectedId) ?? filtered[0]
  const unresolved = incidents.filter((incident) => incident.status !== 'RESOLVED')
  const activeCount = unresolved.length
  const criticalCount = unresolved.filter((incident) => incident.severity === 'CRITICAL').length
  const highCount = unresolved.filter((incident) => incident.severity === 'HIGH').length
  const resolvedCount = incidents.length - activeCount

  const navigate = useCallback((next: View) => { setView(next); window.scrollTo({ top: 0 }) }, [])

  function selectStation(stationId: string) {
    setFilters({ corridor: 'ALL', stationId })
  }

  function openIncident(id: string) {
    setSelectedId(id)
    if (view === 'overview') navigate('reports')
  }

  async function submitReport() {
    if (!draft.report.notes.trim()) {
      setValidation('Add a short operational note before submitting the report.')
      return
    }
    setValidation('')
    setSaveError('')
    setSuccess('')
    setSaving(true)
    try {
      const incident = await createIncident({ ...draft.report, notes: draft.report.notes.trim() })
      setIncidents((current) => [...current, incident])
      setNow(Date.now())
      setSelectedId(incident.id)
      setDraft((current) => ({ ...current, report: { ...current.report, notes: '', severity: 'MEDIUM' } }))
      // Only reached once IndexedDB has confirmed the write.
      setSuccess(`Report saved to this device for ${resolveStation(incident)?.name ?? incident.station}.`)
      if (!incidentVisible(incident, filters)) setFilters(noFilters)
    } catch {
      setSaveError('The report was not saved locally. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function advanceStatus(incident: Incident) {
    const next = nextStatus[incident.status]
    if (!next) return
    const now = new Date().toISOString()
    const updated: Incident = { ...incident, status: next, updatedAt: now, history: [...incident.history, { status: next, at: now }] }
    setActionError('')
    try {
      await updateIncident(updated)
      setIncidents((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    } catch {
      setActionError('The status update was not saved locally. Please try again.')
    }
  }

  const queueFilters = <FilterBar filters={filters} onChange={setFilters} shown={filtered.length} total={incidents.length} />
  const emptyProps = incidents.length === 0
    ? { emptyTitle: 'No reports yet', emptyHint: 'Submitted crowd reports will appear here, prioritised by severity.' }
    : { emptyTitle: 'No reports match these filters', emptyHint: 'Clear the filters to see every report.' }
  const loadingBlock = <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-muted"><LoaderCircle className="animate-spin" size={18} />Opening local incident store…</div>

  return (
    <>
    <AppShell view={view} onNavigate={navigate} title={pageText[view].title} subtitle={loading ? 'Opening the local incident store…' : pageText[view].subtitle(activeCount, criticalCount)} activeCount={activeCount}>
      {(loadError || actionError) && (
        <div role="alert" className="mb-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle size={17} className="shrink-0" />{loadError || actionError}</div>
      )}

      {view === 'overview' && (
        <div className="space-y-6">
          <section aria-label="Incident statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Active reports" value={activeCount} icon={<ShieldAlert size={21} />} tone="bg-tint text-brand-700" helper="Open or acknowledged" />
            <StatCard label="Critical incidents" value={criticalCount} icon={<Siren size={21} />} tone="bg-red-50 text-red-700" helper="Unresolved critical reports" />
            <StatCard label="High severity" value={highCount} icon={<AlertTriangle size={21} />} tone="bg-orange-50 text-orange-700" helper="Unresolved high reports" />
            <StatCard label="Resolved reports" value={resolvedCount} icon={<CheckCircle2 size={21} />} tone="bg-green-50 text-green-700" helper="Closed on this device" />
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(19rem,1fr)] [&>*]:min-w-0">
            <section className="card overflow-hidden" aria-label="Crowd incident queue">
              <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
                <div className="flex items-center gap-2"><ListFilter className="text-brand-600" size={19} /><h2 className="font-semibold text-ink">Crowd incident queue</h2></div>
                <span className="hidden text-xs text-muted sm:block">Active first · risk score · severity · oldest</span>
              </div>
              {queueFilters}
              {loading ? loadingBlock : <IncidentList risks={risks} incidents={filtered.slice(0, QUEUE_PREVIEW)} selectedId={undefined} onSelect={openIncident} onAdvance={(i) => void advanceStatus(i)} {...emptyProps} />}
              {!loading && filtered.length > QUEUE_PREVIEW && (
                <button type="button" onClick={() => navigate('reports')} className="flex w-full items-center justify-center gap-1.5 border-t border-line px-4 py-3 text-sm font-semibold text-brand-700 transition hover:bg-tint">View all {filtered.length} reports<ArrowRight size={15} /></button>
              )}
            </section>

            <div className="space-y-6">
              <RiskOverviewCard overview={riskOverview} onOpen={openIncident} />
              <ActiveByStation counts={counts} selectedStationId={filters.stationId} onSelect={selectStation} />
              <aside className="rounded-2xl border border-blue-200 bg-gradient-to-br from-tint to-white p-5">
                <div className="flex items-center gap-2 font-semibold text-brand-700"><WifiOff size={17} />Built for tunnels and weak signal</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">CrowdX stores reports in this browser, so you can keep filing and updating them offline. Nothing is sent to a server.</p>
              </aside>
              <button type="button" onClick={() => navigate('reports')} className="btn-primary w-full"><Send size={17} />File a crowd report</button>
            </div>
          </div>
        </div>
      )}

      {view === 'reports' && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,1fr)] [&>*]:min-w-0">
          <div className="space-y-6 xl:order-1">
            <section className="card overflow-hidden" aria-label="Incident queue">
              <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
                <div className="flex items-center gap-2"><ListFilter className="text-brand-600" size={19} /><h2 className="font-semibold text-ink">Incident queue</h2></div>
                <span className="hidden text-xs text-muted sm:block">Active first · risk score · severity · oldest</span>
              </div>
              {queueFilters}
              {loading ? loadingBlock : <IncidentList risks={risks} incidents={filtered} selectedId={selected?.id} onSelect={setSelectedId} onAdvance={(i) => void advanceStatus(i)} {...emptyProps} />}
            </section>
            {selected && <IncidentDetails incident={selected} risk={risks.get(selected.id)} onAdvance={() => void advanceStatus(selected)} />}
          </div>
          <aside className="card h-fit p-5 sm:p-6 xl:order-2 xl:sticky xl:top-24">
            <div className="mb-5"><h2 className="font-semibold text-ink">New crowd report</h2><p className="mt-0.5 text-xs text-muted">Saved on this device, even when offline.</p></div>
            <ReportForm draft={draft} onDraftChange={(next) => { setDraft(next); if (validation) setValidation('') }} onSubmit={() => void submitReport()} saving={saving} validation={validation} saveError={saveError} success={success} />
          </aside>
        </div>
      )}

      {view === 'stations' && (
        <StationsView counts={counts} onSelectStation={(id) => { selectStation(id); navigate('reports') }} />
      )}
    </AppShell>
    <PwaNotices />
    </>
  )
}

function incidentVisible(incident: Incident, filters: IncidentFilters) {
  return filterIncidents([incident], filters).length > 0
}

export default App
