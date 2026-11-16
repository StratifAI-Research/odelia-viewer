# Upload error recording

This Playwright walkthrough uses the built OHIF viewer, synthetic files, intercepted DICOMweb responses, and narrowly scoped browser fault injection. It never uploads to a real PACS. It verifies the visible explanations before pausing to make each scene readable.

```bash
pnpm run build:dev
pnpm exec playwright test --config scripts/record-upload-errors/playwright.config.ts
```

Set `UPLOAD_DEMO_OUTPUT` to choose an output directory. Set `DEMO_FAST=1` for a quick validation run without reading pauses. If using a system Chromium instead of Playwright's installed browser, set `UPLOAD_DEMO_CHROMIUM` to its executable path.

The output contains the recorded WebM, screenshots of each result group, a chapter timeline, and the generated mixed-folder fixtures. The recording includes format rejection, empty/unreadable files and folders, HTTP failures, DICOM storage failures and warnings, retry, and cancellation. The page objects use `dicom-upload-*` test IDs added to the upload controls.

To trim browser startup and export an MP4 with chapter markers (requires FFmpeg):

```bash
python3 scripts/record-upload-errors/export-video.py /path/to/upload-demo-output
```
