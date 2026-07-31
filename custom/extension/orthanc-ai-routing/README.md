# orthanc-ai-routing

OHIF extension that sends a study (or selected series) to an AI model for
inference and tracks the resulting job. Built for the ODELIA project. Routing is
performed by an Orthanc-side router service; this extension is the viewer-side UI
and client for it.

## What it provides

- **ServiceModule** — `orthancAIService` (registered in `preRegistration`), the
  client for the router backend: study→Orthanc-ID lookup, model-manifest fetch,
  routing requests, and UPS-RS workitem status polling.
- **PanelModule** — `ai-routing-panel` ("Analyze with AI"), a wizard sidebar
  panel: pick endpoint/model → choose input mode (flat series selection or
  manifest-driven input mapping) → confirm & run → live progress.
- **CommandsModule** — `routeToAI` (`{ studyInstanceUID }`), a thin command
  wrapper over `orthancAIService.routeStudyToAI`.

Consumed by the `send-ai` mode.

## Configuration

The routable AI endpoints come from `window.config.aiEndpoints` (set at deploy
time in `config/app-config.js`). Each endpoint is `{ id, name, url }`. The
in-session endpoint list is mirrored to `localStorage` under the `aiEndpoints`
key — **without** any `username`/`password`, which are never persisted (see
`toPersistableEndpoints` in `AIEndpointConfig.tsx`).

Built-in fallbacks (used only when neither `localStorage` nor
`window.config.aiEndpoints` supplies endpoints — i.e. a misconfigured deployment)
live in [`src/constants.ts`](src/constants.ts):

- `DEFAULT_AI_ENDPOINT_NAME = 'ai-server'`
- `DEFAULT_AI_ENDPOINT_URL  = 'http://orthanc-router-mst:8042/dicom-web'`

`orthancUrl` defaults to `window.location.origin` (the router is reached through
the same-origin proxy).

## Backend API contract

The service talks to the Orthanc router (`orthancUrl`). All routing goes through
the canonical router URL `http://orthanc-router-mst:8042/dicom-web` at deploy
time.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/tools/lookup` | POST | Resolve a DICOM `StudyInstanceUID` (plain-text body) to an Orthanc study ID. |
| `/ai-manifest?target_url=<url>` | GET | Fetch a model's input manifest (`model_id`, `model_name`, `input_configurations[]`). Returns null-ish when the model has no manifest → the panel falls back to flat series selection. |
| `/send-to-ai` | POST | Submit a routing request. |
| `/ups-rs/workitems/{uid}` | GET | Poll UPS-RS workitem status (DICOM+JSON; `ProcedureStepState` 00741000, progress 00741002/00741004/00741006, cancellation 00741238). |

**`/send-to-ai` request shape** (`RoutingRequest`):

```jsonc
{
  "study_id": "<orthanc study id>",   // from /tools/lookup
  "target": "<endpoint name>",
  "target_url": "<endpoint url>",
  "series_uids": ["<SeriesInstanceUID>", ...],   // series routing only
  "input_mapping": { "<roleKey>": "<SeriesInstanceUID>" },  // manifest mode only
  "input_configuration_id": "<config id>"                    // manifest mode only
}
```

Requests carry only study/series identifiers and the target — never
`username`/`password`. The POST has a 30s timeout (`AbortController`).

## Development

```sh
pnpm run test:unit:ci   # jest (see jest.config.js)
pnpm run lint           # eslint src
pnpm run format         # prettier
```

## License

MIT
