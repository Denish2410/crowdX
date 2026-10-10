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
- Service-worker caching has not been added or tested yet, so the app does not claim offline asset availability.
