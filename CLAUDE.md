# BlueFlame Company Enrichment

Browser-based tool for importing company lists and enriching them via LLM APIs (Perplexity / ChatGPT).

## Project layout

- `index.html` — single-page app entry
- `css/styles.css` — styles
- `js/app.js` — main application logic (import, enrich, visualize tabs)
- `js/api-endpoints.js` — API endpoint definitions
- `js/blueflame-api.js` — BlueFlame API client
- `service/` — .NET 8 Windows service (`BlueFlameIngest`) that watches a local folder. Two delivery modes (set in `service/config.json` → `mode`):
  - `ws` — pushes to the local browser via `ws://127.0.0.1:7321/ws` (browser must be opened locally; mixed-content blocks `ws://` from HTTPS).
  - `cloud` — POSTs each accepted file to `/api/ingest` on the Vercel deploy. The deployed app polls `/api/pending` and pulls files from Vercel Blob.
- `api/` — Vercel serverless functions for cloud-mode ingest (`ingest.js`, `pending.js`, `pending/[id].js`, shared `_auth.js`). All require `Authorization: Bearer <INGEST_TOKEN>`. Storage is Vercel Blob under prefix `pending/`.
- `package.json` — Node deps for the `api/` functions (`@vercel/blob`). Frontend remains framework-free.
- `vercel.json` — Vercel deployment config
- `test-*.xlsx`, `test_*.json`, `test_*.js` — test fixtures / scratch files

## Stack

- Vanilla HTML/CSS/JS (no framework)
- `xlsx` (SheetJS) for Excel import/export — loaded via `node_modules`
- Deployed on Vercel

## Conventions

- No build step — edit files in `js/` and `css/` directly
- Keep `node_modules/` out of edits; treat as vendored dependencies
- Test files at repo root are scratch — don't treat as production

## Useful commands

- Open locally: just open `index.html` in a browser
- Deploy: `vercel deploy` (see `vercel.json`)
