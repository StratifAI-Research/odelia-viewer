# labeling

OHIF **extension** (not a mode — the old README misnamed it) providing the ODELIA
study/lesion labeling UI. It lets a reader assign structured labels (per patient,
per study, and per lesion) to a study and export/import them as CSV.

Consumed by the `labeling-mode` mode, which mounts the three panels below in the
right sidebar.

## What it provides

- **PanelModule** — three panels:
  - `panelLabeling` ("Patient label") — patient-level labels.
  - `panelLabelingStudy` ("Study labels") — study-level labels.
  - `panelLabelingLesion` ("Lesion labels") — per-lesion labels, one row per
    `CircleROI` measurement (from `Cornerstone3DTools`). The `ODELIALabel`
    mapping backs the patient/study panels, not these lesion rows.
- **UtilityModule** — `initLabels`, called by the mode on route init to seed the
  measurement service with default `label_data` for the active study.
- **MeasurementService mapping** — registers the `ODELIALabel` tool mapping
  (`initMeasurementService` / `measurementServiceMappings/ODELIALabel.ts`).
- **CSV round-trip** — `downloadCSVReport` (RFC-4180 quoting + formula-injection
  guard) and `importCSVReport` (Papa Parse, `header:true`).

## Configuration

Label sets are defined statically in [`src/utils/config.json`](src/utils/config.json)
as `panel_configs` (one entry per panel: `patient table`, `study table`,
`lesion table`). Each entry's `label_options` is an array of single-key maps —
label name → definition, e.g. `{ "Ethnicity": { "type": "options", "options":
[…] } }`. `type` is `"options"` (a dropdown, with an `options` array whose first
entry is the default) or `"date"` (a date picker, no `options`). To change the
labels a site collects, edit this file; the panels and the initial `label_data`
follow from it. (The TypeScript shape is in [`src/utils/config.ts`](src/utils/config.ts).)

> **Contract note:** `label_data` keys and the CSV column headers are part of the
> data contract with downstream consumers (the label CSV export). Renaming a label
> key changes the CSV schema, so pre-rename exports won't round-trip that column.

## Development

```sh
bun run test:unit:ci   # jest (see jest.config.js)
bun run lint           # eslint src
bun run format         # prettier
```

## License

MIT
