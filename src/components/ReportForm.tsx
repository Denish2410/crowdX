import { AlertTriangle, CheckCircle2, LoaderCircle, Send } from 'lucide-react'
import { corridors, metroStations, stationsOnCorridor } from '../data/stations'
import type { CorridorId } from '../data/stations'
import { severityLabel, severityTone } from '../lib/incidents'
import { severities } from '../types'
import type { NewIncident, Severity } from '../types'

export interface ReportDraft {
  corridor: CorridorId
  report: NewIncident
}

export const initialDraft: ReportDraft = {
  corridor: 'MAIN',
  report: { station: metroStations[0].name, stationId: metroStations[0].id, zone: metroStations[0].zones[0], severity: 'MEDIUM', notes: '' },
}

const selectedStyle: Record<Severity, string> = {
  CRITICAL: 'border-red-600 bg-red-600 text-white shadow-sm',
  HIGH: 'border-orange-500 bg-orange-50 text-orange-800 ring-1 ring-orange-500',
  MEDIUM: 'border-amber-500 bg-amber-50 text-amber-900 ring-1 ring-amber-500',
  LOW: 'border-green-600 bg-green-50 text-green-800 ring-1 ring-green-600',
}

export function ReportForm({ draft, onDraftChange, onSubmit, saving, validation, saveError, success }: {
  draft: ReportDraft
  onDraftChange: (draft: ReportDraft) => void
  onSubmit: () => void
  saving: boolean
  validation: string
  saveError: string
  success: string
}) {
  const { corridor, report } = draft
  const station = metroStations.find((item) => item.id === report.stationId) ?? metroStations[0]
  const setReport = (patch: Partial<NewIncident>) => onDraftChange({ corridor, report: { ...report, ...patch } })

  function changeCorridor(next: CorridorId) {
    const current = stationsOnCorridor(next).find((item) => item.id === report.stationId)
    const target = current ?? stationsOnCorridor(next)[0]
    onDraftChange({ corridor: next, report: { ...report, station: target.name, stationId: target.id, zone: current ? report.zone : target.zones[0] } })
  }

  function changeStation(id: string) {
    const target = metroStations.find((item) => item.id === id) ?? metroStations[0]
    setReport({ station: target.name, stationId: target.id, zone: target.zones[0] })
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit() }} className="space-y-5" noValidate>
      {success && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 text-sm text-green-800"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{success}</div>
      )}

      <fieldset className="space-y-3">
        <legend className="eyebrow mb-1">Location</legend>
        <label className="block text-sm font-medium text-slate-700">Corridor
          <select value={corridor} onChange={(e) => changeCorridor(e.target.value as CorridorId)} className="field mt-1.5">
            {corridors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">Station
          <select value={report.stationId} onChange={(e) => changeStation(e.target.value)} className="field mt-1.5">
            {stationsOnCorridor(corridor).map((item) => (
              <option key={item.id} value={item.id}>{item.sequences[corridor]}. {item.name}{item.isInterchange ? ' (interchange)' : ''}</option>
            ))}
          </select>
        </label>
        {station.isInterchange && <p className="rounded-lg bg-tint px-3 py-2 text-xs text-brand-700">GNLU serves both the main corridor and the GIFT City branch.</p>}
        <label className="block text-sm font-medium text-slate-700">Zone
          <select value={report.zone} onChange={(e) => setReport({ zone: e.target.value })} className="field mt-1.5">
            {station.zones.map((zone) => <option key={zone}>{zone}</option>)}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-2">Severity</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {severities.map((severity) => {
            const selected = report.severity === severity
            return (
              <label key={severity} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-sm font-semibold transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600 ${selected ? selectedStyle[severity] : 'border-line bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}>
                <input type="radio" name="severity" value={severity} checked={selected} onChange={() => setReport({ severity })} className="sr-only" />
                {severity === 'CRITICAL' ? <AlertTriangle size={14} aria-hidden /> : <span className={`h-2 w-2 rounded-full ${severityTone[severity].dot}`} aria-hidden />}
                {severityLabel[severity]}
              </label>
            )
          })}
        </div>
        {report.severity === 'CRITICAL' && <p className="mt-2 text-xs font-medium text-red-700">Critical reports rise to the top of the queue.</p>}
      </fieldset>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-slate-700">Operational notes</label>
        <textarea
          id="notes"
          value={report.notes}
          onChange={(e) => setReport({ notes: e.target.value })}
          placeholder="What is happening, and where?"
          rows={4}
          aria-invalid={Boolean(validation)}
          aria-describedby={validation ? 'notes-error' : undefined}
          className={`field mt-1.5 resize-y ${validation ? 'field-invalid' : ''}`}
        />
        {validation && <p id="notes-error" role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-red-700"><AlertTriangle size={13} />{validation}</p>}
      </div>

      {saveError && <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{saveError}</p>}

      <button disabled={saving} type="submit" className="btn-primary w-full">
        {saving ? <LoaderCircle className="animate-spin" size={17} /> : <Send size={17} />}{saving ? 'Saving to this device…' : 'Submit crowd report'}
      </button>
    </form>
  )
}
