# CrowdX

CrowdX is a local-first metro crowd reporting and incident-response dashboard for a hackathon demonstration. It provides Ahmedabad Metro Phase II demonstration data, a priority incident queue, status history, and persistence through IndexedDB.

## Run locally

```bash
npm install
npm run dev
```

Open the local address Vite prints (normally `http://localhost:5173`).

To create the production bundle:

```bash
npm run build
```

## Deliberate MVP scope

- React, Vite, TypeScript, Tailwind CSS, Lucide React, and `idb` only.
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

Scoring is a pure function over the reports already loaded from IndexedDB (`src/services/riskScoring.ts`). It uses no network, DOM or storage. Scores are **never stored**; they are recomputed from the reports and a reference time on load, when a report is added or changed, and about once a minute while the page is visible, so they cannot go stale or disagree with the data. The IndexedDB schema is unchanged.

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
