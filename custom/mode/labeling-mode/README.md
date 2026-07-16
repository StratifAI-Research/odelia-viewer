# labeling-mode

OHIF **mode** for the ODELIA labeling workflow. Shown in the worklist as
**"ODELIA Mode"** and launched at `/{routeName}` where `routeName` is `odelia`.

It renders a single Cornerstone viewport with the standard series-list on the
left and the three `labeling` panels (patient / study / lesion labels) on the
right, so a reader can measure lesions and assign structured labels in one view.

## Layout

- **Left panel:** `@ohif/extension-default` series list.
- **Right panels:** `labeling` — patient, study, and lesion label panels.
- **Viewport:** `@ohif/extension-cornerstone` stack viewport.
- **Layout template:** default OHIF viewer layout.
- **Hanging protocol:** `view-ai-result.hpSinglePrimary` (single primary viewport).

On route init the mode calls the `labeling` extension's `initLabels` utility to
seed default `label_data` for the active study, then retrieves series metadata
and runs the hanging protocol. Measurement tools (Length, Bidirectional, Probe,
Elliptical/Circle/Rectangle ROI, …) are registered on enter.

## Dependencies (extensions)

- `@ohif/extension-default`, `@ohif/extension-cornerstone`
- `labeling` (the label panels + `initLabels`)
- `view-ai-result` (hanging protocol)

## Configuration

`routeName: 'odelia'` drives the launch URL — the worklist builds the mode link
from it. The label sets themselves are configured in the `labeling` extension
(`src/utils/config.json`), not here.

## License

MIT
