import { useId, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileJson, FileSpreadsheet, LoaderCircle, ShieldAlert, Upload, X } from 'lucide-react'
import { downloadTextFile } from '../lib/download'
import { getDb } from '../lib/db'
import { backupFilename, createBackup, MAX_BACKUP_BYTES, parseBackup } from '../services/backupFormat'
import { readAllActionEvents } from '../services/actionTracking'
import { readAllIncidents, restoreIncidents } from '../services/backupRestore'
import { incidentsToCsv } from '../services/csvExport'
import { kindLabel, planImport } from '../services/importPlan'
import type { ImportPlan, PlanKind } from '../services/importPlan'
import { formatTimestamp } from '../lib/incidents'

type Notice = { tone: 'success' | 'error'; text: string } | null

interface Preview {
  fileName: string
  exportedAt: string
  plan: ImportPlan
}

const kindStyle: Record<PlanKind, string> = {
  ADD: 'border-green-200 bg-green-50 text-green-800',
  IDENTICAL: 'border-slate-200 bg-slate-50 text-slate-700',
  CONFLICT: 'border-amber-300 bg-amber-50 text-amber-900',
  FILE_DUPLICATE: 'border-slate-200 bg-slate-50 text-slate-700',
  FILE_CONFLICT: 'border-amber-300 bg-amber-50 text-amber-900',
  INVALID: 'border-red-200 bg-red-50 text-red-800',
}

function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  if (!notice) return null
  const ok = notice.tone === 'success'
  return (
    <div role={ok ? 'status' : 'alert'} className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm ${ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
      {ok ? <CheckCircle2 size={17} className="mt-0.5 shrink-0" /> : <AlertTriangle size={17} className="mt-0.5 shrink-0" />}
      <span className="flex-1">{notice.text}</span>
      {onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss message" className="text-current opacity-70 hover:opacity-100"><X size={15} /></button>}
    </div>
  )
}

export function DataManagement({ onRestored }: { onRestored: () => Promise<void> | void }) {
  const [exportNotice, setExportNotice] = useState<Notice>(null)
  const [lastExport, setLastExport] = useState<{ json?: Date; csv?: Date }>({})
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null)
  const [importNotice, setImportNotice] = useState<Notice>(null)
  const [reading, setReading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const fileInput = useRef<HTMLInputElement>(null)
  const fileInputId = useId()

  async function exportData(kind: 'json' | 'csv') {
    setExporting(kind)
    setExportNotice(null)
    try {
      const db = await getDb()
      const incidents = await readAllIncidents(db)
      const actionEvents = await readAllActionEvents(db)
      const when = new Date()
      if (kind === 'json') downloadTextFile(backupFilename(when, 'json'), JSON.stringify(createBackup(incidents, when, actionEvents), null, 2), 'application/json')
      else downloadTextFile(backupFilename(when, 'csv', 'crowdx-reports'), incidentsToCsv(incidents, when, actionEvents), 'text/csv;charset=utf-8')
      setLastExport((current) => ({ ...current, [kind]: when }))
      const count = `${incidents.length} ${incidents.length === 1 ? 'report' : 'reports'}`
      setExportNotice({ tone: 'success', text: `${kind === 'json' ? 'JSON backup' : 'CSV'} created with ${count}${incidents.length === 0 ? ' (there are no reports yet)' : ''}. Your browser saves the file; nothing was uploaded.` })
    } catch {
      setExportNotice({ tone: 'error', text: 'The export failed and no file was created. Try again.' })
    } finally {
      setExporting(null)
    }
  }

  function resetImport() {
    setPreview(null)
    setSelected(new Set())
    if (fileInput.current) fileInput.current.value = ''
  }

  async function chooseFile(file: File | undefined) {
    setImportNotice(null)
    setPreview(null)
    if (!file) return
    if (file.size > MAX_BACKUP_BYTES) {
      setImportNotice({ tone: 'error', text: 'This file is larger than 25 MB and was not read.' })
      return
    }
    setReading(true)
    try {
      const parsed = parseBackup(await file.text())
      if (!parsed.ok) {
        setImportNotice({ tone: 'error', text: parsed.error })
        return
      }
      const db = await getDb()
      const existing = await readAllIncidents(db)
      const existingEventIds = new Set((await readAllActionEvents(db)).map((event) => event.id))
      const plan = planImport(parsed.records, existing, parsed.events, existingEventIds)
      setPreview({ fileName: file.name, exportedAt: parsed.exportedAt, plan })
      setSelected(new Set(plan.items.filter((item) => item.kind === 'ADD').map((item) => item.index)))
    } catch {
      setImportNotice({ tone: 'error', text: 'The file could not be read. Nothing was changed.' })
    } finally {
      setReading(false)
    }
  }

  async function restore() {
    if (!preview) return
    const chosen = preview.plan.items.filter((item) => item.kind === 'ADD' && selected.has(item.index))
    const records = chosen.map((item) => item.incident!)
    const chosenIds = new Set(records.map((incident) => incident.id))
    const events = preview.plan.events.filter((item) => item.kind === 'ATTACH' && chosenIds.has(item.event!.incidentId)).map((item) => item.event!)
    if (records.length === 0) return
    setRestoring(true)
    setImportNotice(null)
    try {
      const { added, eventsAdded } = await restoreIncidents(await getDb(), records, events)
      await onRestored()
      resetImport()
      setImportNotice({ tone: 'success', text: `Restored ${added} ${added === 1 ? 'report' : 'reports'}${eventsAdded ? ` and ${eventsAdded} checklist ${eventsAdded === 1 ? 'event' : 'events'}` : ''}. Existing reports were not changed.` })
    } catch (error) {
      setImportNotice({ tone: 'error', text: error instanceof Error ? error.message : 'The restore failed and no records were added.' })
    } finally {
      setRestoring(false)
    }
  }

  const addable = preview?.plan.items.filter((item) => item.kind === 'ADD') ?? []
  const counts = preview?.plan.counts

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5 sm:p-6" aria-label="Export">
          <h2 className="font-semibold text-ink">Back up and export</h2>
          <p className="mt-1 text-sm text-muted">Saves a file to this device. No internet connection is needed and nothing is uploaded.</p>
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-line p-4">
              <div className="flex items-start gap-3"><FileJson className="mt-0.5 shrink-0 text-brand-600" size={20} aria-hidden />
                <div className="min-w-0 flex-1"><p className="font-medium text-ink">Full JSON backup</p><p className="text-xs text-muted">Every report with its complete status history. Use this to restore later.</p>
                  <p className="mt-1 text-xs text-muted">{lastExport.json ? `Last exported this session: ${formatTimestamp(lastExport.json.toISOString())}` : 'Not exported in this session.'}</p></div>
              </div>
              <button type="button" onClick={() => void exportData('json')} disabled={exporting !== null} className="btn-primary mt-3 w-full sm:w-auto">{exporting === 'json' ? <LoaderCircle className="animate-spin" size={16} /> : <Download size={16} />}Export JSON backup</button>
            </div>
            <div className="rounded-xl border border-line p-4">
              <div className="flex items-start gap-3"><FileSpreadsheet className="mt-0.5 shrink-0 text-brand-600" size={20} aria-hidden />
                <div className="min-w-0 flex-1"><p className="font-medium text-ink">CSV for analysis</p><p className="text-xs text-muted">One row per report, including calculated risk at export time. Not a backup: it cannot be restored.</p>
                  <p className="mt-1 text-xs text-muted">{lastExport.csv ? `Last exported this session: ${formatTimestamp(lastExport.csv.toISOString())}` : 'Not exported in this session.'}</p></div>
              </div>
              <button type="button" onClick={() => void exportData('csv')} disabled={exporting !== null} className="btn-ghost mt-3 !px-4 !py-2.5 !text-sm">{exporting === 'csv' ? <LoaderCircle className="animate-spin" size={16} /> : <Download size={16} />}Export CSV</button>
            </div>
          </div>
          {exportNotice && <div className="mt-4"><NoticeBanner notice={exportNotice} onDismiss={() => setExportNotice(null)} /></div>}
        </section>

        <section className="card p-5 sm:p-6" aria-label="Import">
          <h2 className="font-semibold text-ink">Restore from a backup</h2>
          <p className="mt-1 text-sm text-muted">Choose a CrowdX JSON backup. You will see exactly what would change before anything is written.</p>
          <label htmlFor={fileInputId} className="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 text-center transition focus-within:border-brand-600 hover:border-brand-600/60 hover:bg-tint">
            {reading ? <LoaderCircle className="animate-spin text-brand-600" size={22} /> : <Upload className="text-brand-600" size={22} aria-hidden />}
            <span className="text-sm font-medium text-ink">{reading ? 'Checking file…' : 'Select a backup file (.json)'}</span>
            <span className="text-xs text-muted">The file is read on this device only.</span>
            <input id={fileInputId} ref={fileInput} type="file" accept=".json,application/json" disabled={reading || restoring} onChange={(e) => void chooseFile(e.target.files?.[0])} className="sr-only" />
          </label>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-tint px-3 py-2 text-xs text-brand-700"><ShieldAlert size={14} className="mt-0.5 shrink-0" />Restore only adds reports. It never overwrites, merges or deletes existing reports.</div>
          {importNotice && <div className="mt-4"><NoticeBanner notice={importNotice} onDismiss={() => setImportNotice(null)} /></div>}
        </section>
      </div>

      {preview && counts && (
        <section className="card overflow-hidden" aria-label="Import preview">
          <div className="border-b border-line px-5 py-4 sm:px-6">
            <h2 className="font-semibold text-ink">Review before restoring</h2>
            <p className="mt-0.5 text-xs text-muted">{preview.fileName} · exported {formatTimestamp(preview.exportedAt)} · {counts.total} {counts.total === 1 ? 'record' : 'records'}. Nothing has been written yet.</p>
          </div>
          <dl className="grid grid-cols-2 divide-x divide-y divide-line border-b border-line sm:grid-cols-4 sm:divide-y-0">
            {([
              ['To add', counts.ADD, 'text-green-700'],
              ['Already exist', counts.IDENTICAL + counts.FILE_DUPLICATE, 'text-slate-700'],
              ['Conflicts', counts.CONFLICT + counts.FILE_CONFLICT, 'text-amber-800'],
              ['Invalid', counts.INVALID, 'text-red-700'],
            ] as const).map(([label, value, tone]) => (
              <div key={label} className="px-4 py-3"><dt className="text-xs text-muted">{label}</dt><dd className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</dd></div>
            ))}
          </dl>

          {preview.plan.events.length > 0 && (() => {
            const ev = preview.plan.events
            const n = (kind: string) => ev.filter((e) => e.kind === kind).length
            return (
              <p className="border-b border-line px-5 py-3 text-xs text-slate-600 sm:px-6">
                Response checklist events: <strong>{n('ATTACH')}</strong> will be restored with their new reports; {n('NOT_RESTORED') + n('DUPLICATE') + n('UNKNOWN_INCIDENT')} skipped; {n('INVALID')} invalid.
                {ev.filter((e) => e.kind !== 'ATTACH' && e.reason).slice(0, 3).map((e) => <span key={e.index} className="mt-1 block text-slate-500">Event {e.index + 1}: {e.reason}</span>)}
              </p>
            )
          })()}

          {counts.total === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted">This backup contains no reports.</p>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto">
              {preview.plan.items.map((item) => {
                const checkable = item.kind === 'ADD'
                return (
                  <li key={item.index} className="flex items-start gap-3 px-5 py-3 sm:px-6">
                    <input type="checkbox" disabled={!checkable || restoring} checked={checkable && selected.has(item.index)} aria-label={`Restore record ${item.index + 1}${item.id ? ` (${item.id})` : ''}`}
                      onChange={(e) => setSelected((current) => { const next = new Set(current); if (e.target.checked) next.add(item.index); else next.delete(item.index); return next })}
                      className="mt-1 h-4 w-4 shrink-0 accent-brand-600 disabled:opacity-40" />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-ink">{item.incident ? `${item.incident.station} · ${item.incident.zone}` : `Record ${item.index + 1}`}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${kindStyle[item.kind]}`}>{kindLabel[item.kind]}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted">{item.id ?? 'No usable ID'}{item.incident && ` · ${item.incident.severity} · ${item.incident.status}`}</p>
                      {item.differingFields && <p className="mt-1 text-xs text-amber-800">The stored report differs in: {item.differingFields.join(', ')}. The stored version is kept.</p>}
                      {item.errors.map((error) => <p key={error} className="mt-1 text-xs text-red-700">{error}</p>)}
                      {item.warnings.map((warning) => <p key={warning} className="mt-1 text-xs text-slate-500">Note: {warning}</p>)}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-line bg-slate-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex gap-2">
              <button type="button" onClick={resetImport} disabled={restoring} className="btn-ghost !px-4 !py-2.5 !text-sm">Cancel</button>
              {addable.length > 0 && (
                <button type="button" disabled={restoring} onClick={() => setSelected(selected.size === addable.length ? new Set() : new Set(addable.map((item) => item.index)))} className="btn-ghost !px-4 !py-2.5 !text-sm">{selected.size === addable.length ? 'Select none' : 'Select all new'}</button>
              )}
            </div>
            <button type="button" onClick={() => void restore()} disabled={restoring || selected.size === 0} className="btn-primary">
              {restoring ? <LoaderCircle className="animate-spin" size={16} /> : <Upload size={16} />}{restoring ? 'Restoring…' : `Restore selected records (${selected.size})`}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
