# CrowdX

CrowdX is a local-first metro crowd reporting and incident-response dashboard for a hackathon demonstration. It provides Ahmedabad Metro Phase II demonstration data, a priority incident queue, status history, and persistence through IndexedDB.

## Run locally

```bash
npm install
npm run dev
```

Open the local address Vite prints (normally `http://localhost:5173`).

Other commands:

```bash
npm test          # Vitest suite
npm run build     # type-check + production bundle + service worker
npm run preview   # serve the production build at http://localhost:4173 (the service worker and PWA install only work here, not under `npm run dev`)
```

Requires Node.js 20+ (developed on Node 22). `scripts/generate-icons.py` (needs Pillow) regenerates the placeholder PWA icons in `public/`; it is not needed to run the app.

## Features

- Crowd reports with station/zone/severity/notes, a priority queue, corridor and station filters, and OPEN → ACKNOWLEDGED → RESOLVED status history.
- 23 Ahmedabad Metro Phase II stations on two corridors, with GNLU as the shared interchange. **This is demonstration data compiled from a route map; verify names and the station count against official GMRC sources before operational use.**
- Explainable crowd-risk scoring, incident response checklists with derived response-target indicators, and JSON backup / CSV export / additive restore. Each is described below.
- Installable, offline-first PWA.

## Deliberate MVP scope

- React, Vite, TypeScript, Tailwind CSS, Lucide React, `idb` and `vite-plugin-pwa` (Vitest and `fake-indexeddb` for tests only).
- No server, MongoDB, authentication, cloud sync, or network data calls.
- Reports persist in the browser's IndexedDB and survive reloads on the same device/browser.
- The app is a PWA: a Workbox service worker (vite-plugin-pwa) precaches the app shell so it reloads offline. Updates are applied only when staff choose "Reload to update".

## Crowd-risk scoring

CrowdX calculates a **risk score (0–100)** for every report to help staff decide what to look at first. It is **heuristic decision support, not a validated prediction, a measurement of passenger density, or an official metro safety rule.** The weights and band thresholds are uncalibrated demo defaults; have operations staff calibrate them before any real use. Scores never change the staff-reported severity or status, never resolve a report, and never trigger an action.

Severity (what staff reported) and risk (what the engine calculates) are shown side by side and are deliberately separate.

### Formula

`score = severity + unresolved duration + repeat reports`, clamped to 0–100.

| Factor | Max | Points |
| --- | --- | --- |
| Reported severity | 40 | LOW 10 · MEDIUM 20 · HIGH 30 · CRITICAL 40 |
| Unresolved duration | 30 | under 5 min 0 · 5–<15 min 5 · 15–<30 min 10 · 30–<60 min 20 · 60+ min 30 |
| Repeat reports, same station | 30 | 0 others 0 · 1 other 10 · 2 others 20 · 3+ others 30 |

- **Duration** runs from the report time until it is RESOLVED. OPEN and ACKNOWLEDGED reports keep ageing. Future timestamps count as 0 minutes.
- **Repeat reports** count *other, distinct, unresolved* reports at the same station opened within the last **60 minutes** (inclusive, configurable). The report itself, resolved reports, reports with invalid or future timestamps and duplicate records of the same ID are never counted.
- **Station matching** uses `stationId` when present. Older reports without one are resolved through the existing station name/alias table (for example "Gandhinagar Sector 1" → Sector 1). Names that match no known station are grouped by their trimmed, lower-cased name. Reports with no station are not counted.
- **Resolved reports** keep a historical score of severity points only and are never listed as active risk.
- **Bad data** (invalid or missing timestamps or severity, malformed reports) never produces `NaN` or an exception; the affected factor scores 0 and the reason text says so.

### Bands

| Score | Band |
| --- | --- |
| 0–24 | LOW |
| 25–49 | MODERATE |
| 50–74 | HIGH |
| 75–100 | CRITICAL |

### Worked example

A HIGH-severity report opened 35 minutes ago. Two other unresolved reports at the same station were opened 10 and 50 minutes ago.

- Severity HIGH → 30
- Unresolved 35 minutes (30–<60) → 20
- 2 other reports in the last 60 minutes → 20
- **Total 70 → HIGH.** At 60 minutes unresolved it gains 10 more (80, CRITICAL); once the 50-minute-old report drops out of the window it loses 10.

This exact case is covered by a unit test.

### Where it appears

- **Overview:** counts of active critical/high/moderate-risk reports and the top five active reports by risk.
- **Queue:** a risk badge (icon + label + number) beside the severity and status badges. Order: active reports first, then risk score descending, then severity, then oldest first, then ID. Resolved reports go last.
- **Report details:** score, band, per-factor breakdown, reasons, and how the score can change.
- **Stations:** per-station highest active risk and a "highest calculated risk" list. Counts are reports, not passengers.

### Offline behaviour

Scoring is a pure function over the reports already loaded from IndexedDB (`src/services/riskScoring.ts`). It uses no network, DOM or storage. Scores are **never stored**; they are recomputed from the reports and a reference time on load, when a report is added or changed, and about once a minute while the page is visible, so they cannot go stale or disagree with the data. Scoring itself adds nothing to IndexedDB.

### Running tests and the build

```bash
npm test          # Vitest: scoring engine, summaries, ordering and station data
npm run build     # type-check + production bundle + service worker
npm run preview   # serve the production build (the service worker only runs here, not under `npm run dev`)
```

### Verifying offline in a browser

1. `npm run build && npm run preview`, open http://localhost:4173, and wait for the "Ready to work offline" notice.
2. DevTools → Network → Offline (or Airplane Mode), then reload. The app should load and the badge should read "Offline · saved on device".
3. Open **Crowd Reports** and file two reports for the same station. The earlier report's "Repeat reports" factor and risk badge rise immediately.
4. Click **Acknowledge** then **Resolve** on one report. It leaves the risk overview when resolved, and the other report's repeat factor drops.
5. Reload while offline. All reports and their history remain and the scores are recomputed. Over time, the unresolved-duration points step up at 5, 15, 30 and 60 minutes.

### Limitations

- The weights, 60-minute window and band thresholds are demo defaults, not calibrated against real incidents.
- The score only reflects staff reports. It has no passenger counts, sensors, train schedules or station capacity.
- Reports are stored per browser; there is no sync, so each device scores only its own reports.

## Data Management (backup, restore and export)

Open **Data Management** in the sidebar. Everything runs in the browser against IndexedDB; there is no server, upload or network request, so it works offline.

### Export

- **Export JSON backup** downloads `crowdx-backup-YYYY-MM-DD.json` containing every report with its full status history. Use this file to restore.
- **Export CSV** downloads `crowdx-reports-YYYY-MM-DD.csv`, one row per report, for analysis in a spreadsheet. A CSV is **not** a backup and cannot be restored.
- After each export the page shows how many reports were written and the time of the last export in this session (the last-export time is kept in memory only).

### JSON backup format (schema version 2)

```json
{
  "app": "CrowdX",
  "schemaVersion": 1,
  "exportedAt": "2026-10-10T12:00:00.000Z",
  "stationDataset": { "stationCount": 23, "stationIds": ["ST_MOTERA_STADIUM", "..."] },
  "incidents": [
    { "id": "…", "station": "GNLU", "stationId": "ST_GNLU", "zone": "Interchange", "severity": "HIGH",
      "notes": "…", "status": "OPEN", "createdAt": "…", "updatedAt": "…",
      "history": [{ "status": "OPEN", "at": "…" }] }
  ],
  "actionEvents": [
    { "id": "…", "incidentId": "…", "actionId": "PB_HIGH_REVIEW", "type": "COMPLETED",
      "at": "…", "actor": "Demo staff", "seq": 1 }
  ]
}
```

- `incidents` are the app's own report objects, unchanged. `actionEvents` (schema version 2) is the response-checklist log described below. These two stores are the only persisted application data.
- **Compatibility:** version 1 backups (no `actionEvents`) are still accepted and restore normally with no checklist events. Version 2 requires the `actionEvents` array. Anything newer than version 2 is rejected.
- `stationDataset` is informational metadata. Stations are not restored from a backup; the app's built-in 23-station dataset is always used.
- **Calculated risk scores are not stored** in the backup. They are derived values and are recomputed from the restored reports.
- Files with a `schemaVersion` newer than the app supports are rejected with a message rather than guessed at.

### CSV columns

`report_id, station_name, station_id, corridor, zone, reported_severity, status, calculated_risk_score, calculated_risk_band, risk_counts_as_active, risk_reference_time, notes, created_at, updated_at, resolved_at, status_history`

- Timestamps are ISO 8601. Risk is calculated by the existing scoring service at the export time, which is written to `risk_reference_time` on every row. `station_id` and `resolved_at` are left blank when the report has none.
- The file is UTF-8 with a byte-order mark so Excel reads Gujarati and other non-ASCII text correctly. Rows use CRLF line endings and cells containing commas, quotes or line breaks are quoted (RFC 4180).
- **Formula-injection protection:** text cells beginning with `=`, `+`, `-`, `@`, a tab or a carriage return are prefixed with an apostrophe (`'`), so a note like `=HYPERLINK(...)` is shown as text. The apostrophe is visible in the data.

### Restoring a backup safely

1. Choose a `.json` backup. The file is read locally and **nothing is written yet**.
2. The preview shows counts of records to add, already-existing, conflicting and invalid, with the reason for each record. New records are pre-selected; untick any you do not want.
3. Click **Restore selected records**. All selected records are written in one IndexedDB transaction. If anything fails, none are added and an error is shown; success is shown only after the transaction completes.

Validation is strict and nothing is silently repaired: each record needs a non-empty `id`, `station`, `zone` and string `notes`; a valid `severity` and `status`; ISO 8601 `createdAt`/`updatedAt`; and a non-empty, chronological `history` ending at the current status. The station must be a known `stationId`, or, for older records without one, a known station name or alias (for example "Gandhinagar Sector 1"), which is resolved to its station ID and noted in the preview. Unknown fields are ignored and noted.

**Duplicates and conflicts (additive restore only)**

- A record identical to a stored one is skipped ("already exists").
- A record with the same ID as a stored report but different content is a **conflict**: it is skipped, the differing fields are listed and the stored report is kept. Restore never overwrites, merges or deletes existing reports. There is no replace mode in this version.
- The same ID twice in the file: identical repeats are skipped; if the copies differ, all copies are held back as a file conflict.
- Restore uses `add`, so even if a report appears in IndexedDB between preview and restore, the colliding batch is rolled back instead of overwriting it.

### Tests and build

```bash
npm test          # Vitest, including backup/restore tests against an in-memory IndexedDB (fake-indexeddb)
npm run build     # type-check, production bundle and service worker
npm run preview   # serve the build; the service worker only runs here, not under `npm run dev`
```

### Offline behaviour and limitations

- Export, validation, preview and restore use only browser APIs and IndexedDB, so they work in Airplane Mode. The service worker, update prompt and online/offline badge are unchanged.
- **Privacy:** backups and CSV files contain incident data (stations, notes, timestamps). Store them securely and share them only with authorised staff. Files are not encrypted.
- **Data loss:** reports live only in this browser. Clearing site data, using a private window, uninstalling the app or losing the device erases them. Export a backup regularly and keep it somewhere safe.
- Restore is additive only (no replace or merge), is limited to 25 MB per file, and the "last exported" time resets when the page is reloaded.
- Backups restore into the current database schema (version 2). Checklist events are restored only together with a report that is itself being newly restored; they are never attached to, or merged into, a report already on the device.

## Incident response playbooks (illustrative)

> **All example procedures are illustrative prototype content.** They are not official GMRC procedures and do not replace approved emergency protocols. Operations owners must define, review and approve real procedures before any operational use.

Each report's detail view has a **Response checklist** chosen from the report's staff-reported severity (LOW 2 actions, MEDIUM 3, HIGH 3, CRITICAL 3). Definitions live in `src/services/playbooks.ts` as plain data (stable action ID, title, description, severity, optional response target), separate from the UI.

- **Completing and undoing:** tick an action to record a `COMPLETED` event; untick to record an `UNDONE` event. Events are append-only, so undoing keeps the audit trail. Each event has an ID, incident ID, action ID, type, timestamp, actor label and a per-action sequence number. The current state is derived from the latest event.
- **Duplicates:** completion is checked and written inside one IndexedDB transaction, so double clicks and retries produce a single event (a repeated completion, or an undo of an incomplete action, is a no-op).
- **Actor:** events use the label "Demo staff". CrowdX has no authentication, so this is **not a verified identity**.
- **No automatic resolution:** finishing every action never resolves the incident or changes its severity or status; resolving remains a separate staff action.
- **Escalation indicators:** each action can have a response target in minutes measured from when the report was created (defaults: CRITICAL 5/5/15, HIGH 15/15/30, MEDIUM 30/30/60, LOW 60 and none). An unresolved incident shows its elapsed time, and unfinished actions past their target show **"Response target exceeded"** in the queue and the checklist. This is derived from timestamps each time the screen refreshes (about once a minute while the page is open, and on reload); no "overdue" flag is stored. Completed actions are never overdue (late ones are labelled "after target"), and resolved incidents show no overdue actions.
- **Changing targets:** edit `responseTargetMinutes` in `defaultPlaybookConfig`, or pass your own `PlaybookConfig` to `getPlaybook` / `deriveChecklist`. Keep existing action IDs stable because they are stored in events and backups.

### Storage, upgrade and backups

- Events live in a new `actionEvents` object store with a `by-incident` index. The database version went from 1 to 2. The upgrade only adds the new store; it never touches, clears or recreates `incidents`, so existing reports and histories load unchanged (covered by a migration test and checked against a real version 1 database in Chrome).
- JSON backups (schema version 2) include `actionEvents`. On import each event is validated: known action for the incident's severity, ISO 8601 timestamp, valid type, non-empty actor, `seq` 1..n without gaps, strictly alternating `COMPLETED`/`UNDONE` starting with `COMPLETED`, timestamps not going backwards, a known incident, and an unused event ID. Invalid, duplicate, orphaned or not-restored events are listed in the preview and skipped. Restore is still one all-or-nothing transaction covering reports and events.

### Limitations

- Indicators update only while CrowdX is open; there are no push notifications, background alerts or services, and nothing runs while the app is closed.
- Targets are demo values and are not calibrated or approved. Checklists are per device and do not sync.
- If an older CrowdX tab is still open when the new version first loads, the database upgrade waits until that tab is closed or reloaded.
- Playbook definitions are not stored in backups (only the events and their action IDs), so a restore into a build with different definitions will skip events whose actions no longer apply.
