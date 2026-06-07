---
name: browser-qa-sweep
description: Use when you need manual-QA-style regression testing of the deployed OHIF viewer stack in a real browser after changes to the viewer or platform — capturing screenshots of core UI surfaces and producing a regression report. Triggers include "QA the viewer", "does the stack still work", "screenshot the UI", manual QA before a merge or release.
---

# Browser QA Sweep

## Overview

Drive the **running, deployed** stack in a real browser via a subagent, screenshot
every core surface, look at the screenshots, and write a regression report. This is
automated manual-QA — it catches what unit/e2e tests miss (auth flow, blank screens,
console storms, layout breakage) on the actual deployed images, not a dev build.

Complements **verifying-ui-in-browser** (a developer checklist): this skill *orchestrates*
a screenshot sweep + report, the other is the per-surface eyeball checklist to apply.

## When to use
- After changing the viewer image, platform compose, or component images
- Before a release / merging a stack-affecting PR
- Smoke-testing a freshly spun stack ("does everything still come up and render?")

Not for: pure unit/logic changes with no deployed-UI impact.

## Prerequisites
- Stack running and reachable on the host (`docker compose ps` all up; `curl localhost:8081` responds)
- Run the browser **on the host where the stack runs** (localhost reach). Playwright +
  chromium are installed there; run `node` from the `odelia-viewer` repo root so `playwright` resolves.
- Login creds via env (`QA_USER`/`QA_PASS`) — never hardcode. Keycloak realm `ohif` has `viewer`/`pacsadmin`.
- **Test data:** viewing surfaces (viewport, tools, measurements, MPR) need DICOM studies in
  Orthanc. With an empty Orthanc, scope to no-data surfaces and mark the rest `NEEDS DATA`.

## Workflow (subagent-driven)
1. Confirm the stack is up and reachable (ps + curl).
2. Edit `qa-runner.mjs` `SURFACES` for the surfaces in scope this sweep.
3. **Dispatch a subagent** (model floor: sonnet) to:
   - run the runner on the host: `QA_USER=… QA_PASS=… node .claude/skills/browser-qa-sweep/qa-runner.mjs`
   - copy `qa-out/` back locally (scp) and **Read each screenshot** (images), plus `results.json`
   - assess each surface against the checklist below and write report rows
   - For many surfaces, fan out — see **REQUIRED SUB-SKILL:** superpowers:dispatching-parallel-agents
4. Synthesize the per-surface findings into one regression report (format below).

**Auth / session (important):** the runner uses ONE browser context, so the Keycloak/
oauth2-proxy session cookie persists — log in **once**, not per surface. After every
navigation, **wait for the app to actually render** (URL out of `/realms/`, app shell
present) before screenshotting; a screenshot that shows the Keycloak login/redirect page
is a runner-timing bug, **not** a real surface (the only intended login shot is `00-login`).
The runner's `ensureAppLoaded()` does this; if you script flows yourself, replicate it.

## Surfaces (core features)
| Surface | Needs data? | What to check |
|---|---|---|
| Login / auth redirect | no | Keycloak login renders; creds land you in the app |
| Study list | no | Loads, renders columns, search box works, empty state is sane |
| Invalid/empty study URL | no | Graceful error, not a white screen |
| AI routing panel + send-to-AI | **yes** | Not just "opens" — **drive the full wizard to Send** and verify a fresh result lands. See *Send-to-AI roundtrip* below. |
| Chat | **yes** | Chat panel opens, connects (websocket) |
| Viewport + tools | **yes** | Image renders; zoom/pan/window-level work |
| Measurements | **yes** | Length/annotation tools place + persist |
| MPR | **yes** | Reconstruction renders in 3 planes |
| Feedback / Grafana (:3000) | no | Login page renders |

Every surface also: **no console errors**, **renders (no white screen)**, **lands where expected**.

## Send-to-AI roundtrip (required — do not stop at "panel opens")

Opening the AI panel is **not** enough. Drive the whole flow and confirm a result comes back:

1. Open the study in send-ai mode (`/viewer/template?StudyInstanceUIDs=<uid>`); open the AI routing panel.
2. Record a **baseline** of Orthanc first: `curl -s http://localhost:8000/statistics` (note `CountInstances`/`CountSeries`).
3. Walk the wizard to the end and press **Send to AI**:
   - Step 1: pick the AI model (MST is usually pre-selected).
   - Step 2: pick an input mode (e.g. Multiphase).
   - Step 3: map the series (e.g. "NCI-dyn DEV") to the input key.
   - Step 4: click **Send to AI**.
   - The research-use **"Confirm and Hide"** banner intercepts pointer events — if a normal
     click does nothing, dispatch the click via JS (`el.click()`), then continue.
4. **Verify the result**: poll `curl -s http://localhost:8000/statistics` until `CountInstances`
   rises above baseline (new **SR** + **SC** series). Check the new series have a **fresh
   `LastUpdate`** (today, after the test started) and Modality SR/SC. Cross-check the router
   log: `sudo docker logs odelia-orthanc-router-mst` (workitem → model call → upload).
5. Reload the study and screenshot the AI result (SR / heatmap) in the viewer.

If the model backend is down (e.g. medgemma needs a token, MST weight-load error), report
exactly where it breaks (UI send / router→model / inference / upload) — don't report PASS
just because the panel rendered.

## Reading results
`qa-out/results.json` has per-surface `url`, `screenshot`, `consoleErrors`, `ok`.
**Look at every screenshot** — `ok:true` only means the script didn’t throw, not that the
page is correct. Blank/garbled/misplaced UI only shows in the image.

## Regression report format
Write to `design_docs/qa/<date>-qa-sweep.md`:
- **Summary:** N surfaces, X pass / Y issues / Z needs-data
- **Per surface:** ✓ / ⚠ / ✗ · screenshot path · console errors · one-line verdict
- **Issues found:** numbered, with screenshot + repro
- **Needs data:** surfaces skipped for lack of studies
- **Verdict:** safe-to-ship? regressions vs prior sweep?

## Common pitfalls
- Running the browser on your laptop can’t reach the host’s `localhost` — run it on the host (or tunnel).
- `playwright` not resolving → run `node` from the repo root (its `node_modules`).
- Trusting `ok:true` without looking at the image — the #1 way a broken UI passes QA.
- Hardcoding creds in the runner — use env.

## Notes & known limitations
- **One app per run.** The runner targets a single `QA_BASE_URL`. Sweep Grafana (and any
  other separate app) as its own run: `QA_BASE_URL=http://localhost:3000` with a Grafana
  `SURFACES` list — do not expect the default viewer run to cover it.
- **Login page is captured** as `00-login.png` before authenticating, so a broken auth page is visible.
- **`ok:true` only means the navigation did not throw** — it is NOT proof the page is correct.
  An invalid-study URL that silently redirects to the study list will show `ok:true`. Always
  eyeball every screenshot and judge it by what it actually shows.
- **Assertions are a future enhancement.** v1 is screenshot + console-error capture only; it
  does not assert expected elements per surface, and some OHIF builds swallow backend 5xx
  without console errors (invisible without a seeded study). Treat this as exploratory QA, not a gate.
