# BlueFlameIngest — Auto-import Windows Service

Watches a folder on the local machine for `.xlsx`, `.xls`, and `.csv` files and pushes them to the BlueFlame web app over a localhost WebSocket. The browser then runs the same import path it would for a manual upload.

## Architecture

Two delivery modes, picked in `config.json` → `mode`:

```
mode: "ws"                                       mode: "cloud"
─────────                                        ─────────────
File ──► gates ──► ws://127.0.0.1:7321 ──► browser   File ──► gates ──► POST /api/ingest ──► Vercel Blob
                   (browser opened locally)                                                       │
                                                                                                  ▼
                                                                                        browser polls /api/pending
                                                                                                  │
                                                                                                  ▼
                                                                                          handleFileUpload
```

All gating happens **in the service** — rejected files never reach the browser. Pick whichever mode matches where you'll open the app.

## Prerequisites

- Windows 10 / 11 or Server 2019+
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) (only needed to build)
- Run install/uninstall scripts from an **elevated** PowerShell prompt

## Build & install

```powershell
cd "C:\Company List Enrichment Application\service"
.\install.ps1
```

This publishes a self-contained single-file exe to `service\publish\BlueFlameIngest.exe`, registers it as the `BlueFlameIngest` Windows service, and starts it. Restart-on-failure is configured.

Health check:

```powershell
curl http://127.0.0.1:7321/health
# { "status": "ok", "clients": 0, "watching": "C:\\BlueFlameInbox" }
```

## Use it

1. Open `index.html` locally (double-click, or serve via `http://localhost`). The Vercel-hosted version **will not work** — browsers block `ws://` from HTTPS pages.
2. The top-bar pill should switch from "Auto-ingest: off" to "**Auto-ingest: watching**" within ~2 s.
3. Drop a file into `C:\BlueFlameInbox\`. The pill flashes green, the app jumps to the Import tab, and the file loads exactly as if you had browsed for it.

## Config (`config.json`)

Lives next to the exe in `publish\config.json`. After editing, restart the service:

```powershell
Restart-Service BlueFlameIngest
```

| Key | Default | Purpose |
| --- | --- | --- |
| `watchFolder` | `C:\BlueFlameInbox` | Inbox the watcher monitors |
| `processedFolder` | `…\processed` | Successfully ingested files moved here |
| `rejectedFolder` | `…\rejected` | Gate failures moved here, with `<file>.reason.txt` alongside |
| `webSocketPort` | `7321` | Kestrel binds to `127.0.0.1` only |
| `fileSettleMs` | `750` | Debounce window between watcher events for the same file |
| `maxLockWaitSeconds` | `30` | Max time to wait for an upload to finish writing |
| `gates.extensions` | `.xlsx`, `.xls`, `.csv` | Allowed file extensions |
| `gates.filenamePattern` | `null` | Optional regex; `null` = accept any name |
| `gates.minBytes` | `100` | Reject smaller files |
| `gates.maxBytes` | `26214400` | Reject larger files (default 25 MB) |
| `gates.maxAgeMinutes` | `null` | Reject files older than N minutes; `null` disables |
| `gates.dedupeByHash` | `true` | SHA-256 dedupe; store in `.dedupe.json` (capped at 1000) |
| `mode` | `ws` | `"ws"` (local WebSocket bridge) or `"cloud"` (POST to Vercel) |
| `cloud.ingestUrl` | `https://your-app.vercel.app/api/ingest` | Vercel ingest endpoint (only used when `mode=cloud`) |
| `cloud.ingestToken` | `REPLACE_…` | Bearer token; must equal Vercel env var `INGEST_TOKEN` and the value pasted into the app's Configuration tab |
| `cloud.httpTimeoutSeconds` | `60` | Upload timeout |

## Cloud mode — using the Vercel deploy as the bridge

Use this when you want to open the app from `https://your-app.vercel.app` (browsers block `ws://` from an HTTPS page, so `ws` mode would silently fail).

**One-time Vercel setup** (in the dashboard):

1. **Storage → Create Blob store** and link it to the project. Vercel auto-injects `BLOB_READ_WRITE_TOKEN` into the deployment.
2. **Settings → Environment Variables** → add `INGEST_TOKEN` (32+ random chars) and redeploy.

**Service config:**

```json
{
  "mode": "cloud",
  "cloud": {
    "ingestUrl": "https://your-app.vercel.app/api/ingest",
    "ingestToken": "<same value as INGEST_TOKEN>"
  }
}
```

Then `Restart-Service BlueFlameIngest`.

**Browser:** open the Vercel URL → Configuration tab → paste the same `INGEST_TOKEN` into "Ingest Token" → Save. The pill flips to "Auto-ingest: watching" within ~3 s and any file dropped into `C:\BlueFlameInbox\` lands in the app.

**Limit to know about:** Vercel serverless functions cap request bodies at **~4.5 MB on the Hobby plan** (32 MB on Pro). Files exceeding this fail at the edge — the service surfaces a clear `cloud upload failed: file exceeds Vercel function body cap` reject reason in the activity log. Either upgrade to Pro or keep spreadsheets under the cap.

## Behaviour notes

- **No browser connected.** The service holds the file in the inbox and re-queues it every 2 s until a client connects. Nothing is lost if the browser is closed.
- **Multiple browsers connected.** All connected clients receive the file; useful if you keep two windows open.
- **File still being written.** The processor polls until it can open the file with `FileShare.Read`, up to `maxLockWaitSeconds`.
- **Pre-existing files at startup.** Anything already in `watchFolder` when the service starts is enqueued.

## Logs

Service logs go to the Windows Application event log under source `BlueFlameIngest` (created automatically). For live tailing during development, run from a terminal instead of as a service:

```powershell
cd "C:\Company List Enrichment Application\service"
dotnet run
```

## Uninstall

```powershell
.\uninstall.ps1
```
