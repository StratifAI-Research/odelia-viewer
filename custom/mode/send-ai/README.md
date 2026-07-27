# send-ai

OHIF **mode** for the ODELIA "analyze with AI" workflow (the old README —
"Test send to ai functionality" — was template placeholder text). Shown in the
worklist as **"AI Analysis Mode"** and launched at `/{routeName}` where
`routeName` is `send-ai`.

It combines routing a study to an AI model with reviewing the result in one
layout: the `orthanc-ai-routing` wizard sends the study, and the `view-ai-result`
panels/viewport display the returned heatmaps, reports, feedback, and chat.

## Layout

- **Left panel:** `view-ai-result` study browser (`seriesList`), resizable.
- **Right panels:** `orthanc-ai-routing` "Analyze with AI" panel, plus
  `view-ai-result` Feedback and AI Chat panels, resizable.
- **Viewport:** `view-ai-result` `ai-tracked-viewport`.
- **Layout template:** `view-ai-result.odeliaViewerLayout` (default layout +
  disclaimer banner).

On mode enter it clears prior measurements, enables the nested AI sub-tabs
(`studyBrowser.tabMode = 'study-ai-subtabs'`), and registers basic browsing tools
(WindowLevel, Pan, Zoom, StackScroll).

## Dependencies (extensions)

- `@ohif/extension-default`, `@ohif/extension-cornerstone`
- `orthanc-ai-routing` (routing panel + service)
- `view-ai-result` (viewport, panels, layout, hanging protocol)

## Configuration

`routeName: 'send-ai'` drives the launch URL (renamed off the OHIF-template
placeholder `template`; verified deploy-safe — nothing in nginx, app-config, or
Keycloak pins the old path). AI endpoints are configured via
`window.config.aiEndpoints` — see the `orthanc-ai-routing` README for the backend
contract.

## License

MIT
