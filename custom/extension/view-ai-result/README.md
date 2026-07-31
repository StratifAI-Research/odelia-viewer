# view-ai-result

OHIF extension that displays AI inference results for the ODELIA project:
AI-generated heatmaps (SC) and structured reports (SR), a classification overlay,
a feedback panel, and an AI chat panel. Built for the ODELIA project.

## What it provides

- **PanelModule** — three panels:
  - `seriesList` — a study browser (`PanelStudyBrowserTracking`) that groups AI
    results into per-model, per-run sub-tabs alongside the original series.
  - `aiFeedback` — a panel for capturing reader feedback on a result.
  - `aiChat` — a chat panel over the AI result (markdown is DOMPurify-sanitized).
- **ViewportModule** — `ai-tracked-viewport`, a Cornerstone viewport wrapper that
  tracks the active AI result and drives the classification overlay.
- **ServiceModule** — `aiResultsService` (selection/state for the active AI
  result) and `chatService`, both registered in `preRegistration`.
- **LayoutTemplateModule** — `odeliaViewerLayout`, the default OHIF layout plus a
  `DisclaimerBanner`.
- **HangingProtocolModule** — `hpSinglePrimary`, a single-primary-viewport layout.
- **CommandsModule** — `toggleHeatmapImageSliceSync` (and a no-op
  `resetCrosshairs`); `preRegistration` also registers a `heatmapImageSlice`
  synchronizer type with the sync-group service.
- **ToolbarModule** — a `evaluate.heatmapSync` evaluator that lights up the
  heatmap-sync toolbar button when the synchronizer is active.

Consumed by the `send-ai` and `labeling-mode` modes (the latter uses its hanging
protocol).

## Configuration

- **AI sub-tabs** — the nested study-browser grouping is toggled by the
  `studyBrowser.tabMode` customization; `send-ai` sets it to `study-ai-subtabs`
  on mode enter. AI results are grouped by the report SR's SOP Instance UID via
  the shared `utils/aiTabHelpers.ts`; `InstanceCreationDateTime` (with DICOM
  timezone offset) only labels and sorts the groups.
- **AI result classification** — an SR/SC display set is treated as an AI result
  by `isAIResult` (Modality `SR` or `SC`).

## Development

```sh
pnpm run test:unit:ci   # jest (see jest.config.js)
```

The unit suite is timezone-independent: `formatDicomDateTime` renders DICOM
date/time components verbatim, so the tests pass regardless of the runner's `TZ`.

## License

MIT
