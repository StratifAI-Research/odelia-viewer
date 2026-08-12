<div align="center">
  <h1>ODELIA Viewer</h1>
  <p>
    <strong>A web-based DICOM viewer with built-in AI workflows for the <a href="https://odelia.ai/">ODELIA</a> project.</strong><br/>
    Zero-footprint, DICOMweb-native, and built on the <a href="https://ohif.org/">OHIF Viewer</a>. Maintained by <a href="https://www.stratifai.com/">StratifAI</a>.
  </p>

  <p>
    <a href="https://odelia.ai/">ODELIA Project</a> ·
    <a href="https://www.stratifai.com/">StratifAI</a> ·
    <a href="https://github.com/StratifAI-Research/odelia-viewer-platform">ODELIA Viewer Platform</a>
  </p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"/></a>
    <a href="https://hub.docker.com/r/stratifai/odelia-viewer"><img src="https://img.shields.io/docker/v/stratifai/odelia-viewer?sort=semver&label=docker" alt="Docker image version"/></a>
    <a href="https://hub.docker.com/r/stratifai/odelia-viewer"><img src="https://img.shields.io/docker/pulls/stratifai/odelia-viewer.svg" alt="Docker pulls"/></a>
    <a href="https://github.com/StratifAI-Research/odelia-viewer/actions/workflows/docker-build-push.yml"><img src="https://github.com/StratifAI-Research/odelia-viewer/actions/workflows/docker-build-push.yml/badge.svg" alt="Docker Build & Push"/></a>
    <a href="https://github.com/StratifAI-Research/odelia-viewer/actions/workflows/tests.yml"><img src="https://github.com/StratifAI-Research/odelia-viewer/actions/workflows/tests.yml/badge.svg" alt="Tests"/></a>
  </p>
</div>

---



The ODELIA Viewer is the medical-imaging front end of the **ODELIA** project, an EU-funded
initiative building open-source swarm learning for privacy-preserving medical AI, with a focus on
breast-cancer detection in MRI. It is a fork of the [OHIF Viewer](https://ohif.org/) extended with
ODELIA-specific AI workflows.

On top of OHIF's standard capabilities (2D/3D/MPR rendering, segmentation, structured reports,
measurements, OpenID Connect, hotkeys, DICOMweb), this viewer lets you send a study to an AI model
and review the results without leaving the viewer.

**This repository builds only the viewer itself**. To run ODELIA as a whole, **start with the
[ODELIA Viewer Platform](https://github.com/StratifAI-Research/odelia-viewer-platform)**, which provides
the full, runnable stack (viewer + Orthanc PACS + AI services + authentication + monitoring).



## Running it

For any real deployment, use the
[ODELIA Viewer Platform](https://github.com/StratifAI-Research/odelia-viewer-platform).

The published image serves a static single-page app behind nginx, which you can run with just
[Docker](https://docs.docker.com/get-docker/):

```bash
docker pull stratifai/odelia-viewer:latest
docker run --rm -p 3000:80 stratifai/odelia-viewer:latest
# open http://localhost:3000/viewer
```

On its own this serves the viewer shell only — the default config expects a DICOMweb backend
(`/pacs/dicom-web`) and authentication (`/keycloak`), so loading studies and signing in require the
platform stack or a [custom config](#configuration).



### Configuration

The viewer reads [`app-config.js`](custom/config/app-config.js) at load time. To point it at your own services
**without rebuilding**, override it at container start:

- set the **`APP_CONFIG`** environment variable to the full config file contents — the entrypoint writes it to `app-config.js`; or
- mount your own file over `/usr/share/nginx/html/app-config.js` (the path follows `PUBLIC_URL`, which defaults to `/`).

Common entrypoint env vars:

- **`PUBLIC_URL`** — base path (default `/`)
- **`PORT`** — HTTP port (default `80`)
- **`SSL_PORT`** — serve HTTPS on this port (HTTP only if unset); also requires a certificate and key mounted at `/etc/ssl/certs/ssl-certificate.crt` and `/etc/ssl/private/ssl-private-key.key`

## Local development

### Prerequisites

- **[pnpm](https://pnpm.io/) 11 or newer** — install it with pnpm's [standalone script](https://pnpm.io/installation#using-a-standalone-script) or Homebrew; both work without a pre-existing Node.
- **[Docker](https://www.docker.com/get-started/)** *(optional)* — only needed to build the production image.

Node is **not** a prerequisite. It is declared as `devEngines.runtime` in
[`package.json`](package.json), so `pnpm install` downloads the pinned version, records its
resolution in `pnpm-lock.yaml`, and runs every project script with it — no version manager, and no
mismatch with CI.

### Setup

```bash
pnpm install        # fetch the pinned Node + workspace dependencies
pnpm run dev        # start the dev server (http://localhost:3000)
docker build -t stratifai/odelia-viewer:local .  # optional: build docker image
```



### Tests

Unit tests (Jest):

```bash
pnpm run test:unit     # run all unit tests with coverage
pnpm run test-watch    # run in watch mode
```

End-to-end tests (Playwright). Fetch the test data once with `pnpm run test:data`. Then run the full suite:

```bash
pnpm run test:e2e:ci   # headless
```

Note: Swap in `test:e2e:ui` (interactive), `test:e2e:headed` (visible
browser), or `test:e2e:debug` (step-through) if needed.

## Repository structure

This repository is a fork of the OHIF Viewer (version recorded in [`version.json`](version.json)),
organized as a monorepo. The OHIF source (`platform/`, `extensions/`, `modes/`) is kept
close to upstream and periodically re-merged; ODELIA's viewer code lives under `custom/`, with
deployment and test assets alongside:

```
.
├── custom/        # ODELIA viewer extensions, modes, and app config   ← ODELIA
├── platform/      # OHIF core, UI, i18n, app shell + pluginConfig.json  (upstream)
├── extensions/    # OHIF extensions (cornerstone, segmentation, …)      (upstream)
├── modes/         # OHIF workflow modes                                 (upstream)
├── deploy/        # config for the reference docker-compose stack
├── tests/         # Playwright end-to-end tests
├── Dockerfile     # builds the stratifai/odelia-viewer image
└── docker-compose.yml  # reference stack (use the platform repo for production)
```

## ODELIA customizations

The `custom/` directory holds the ODELIA viewer extensions, modes, and runtime config:

| Path | What it adds |
| --- | --- |
| [`custom/extension/orthanc-ai-routing`](custom/extension/orthanc-ai-routing) | **Send to AI** — route a study to a configured AI endpoint via the Orthanc routing plugin, plus endpoint-management UI |
| [`custom/extension/view-ai-result`](custom/extension/view-ai-result) | **View AI results** — load and display a model's inference output alongside the images |
| [`custom/extension/labeling`](custom/extension/labeling) | **Labeling** — lesion labeling UI, ODELIA measurement-service mappings, CSV import/export |
| [`custom/mode/send-ai`](custom/mode/send-ai) | Send-to-AI workflow mode |
| [`custom/mode/labeling-mode`](custom/mode/labeling-mode) | Labeling workflow mode |
| [`custom/config/app-config.js`](custom/config/app-config.js) | Default viewer configuration (data sources, AI endpoints, UI options) baked into the image — [overridable at runtime](#configuration) |

Custom extensions and modes are declared as workspaces in [`package.json`](package.json)
(`custom/extension/*`, `custom/mode/*`) and registered in
[`platform/app/pluginConfig.json`](platform/app/pluginConfig.json).

## About ODELIA

[ODELIA](https://odelia.ai/) (Open Consortium for Decentralized Medical Artificial Intelligence)
unites partners across Europe to build the first open-source **swarm learning** framework — training
medical AI across institutions without sharing patient data — and to develop and validate AI for
breast-cancer detection in MRI.

- [ODELIA website](https://odelia.ai/)
- [EU CORDIS project page](https://cordis.europa.eu/project/id/101057091)

> This project has received funding from the European Union's Horizon Europe research and innovation
> programme under grant agreement [No 101057091](https://cordis.europa.eu/project/id/101057091).

## Built on OHIF

ODELIA Viewer is a fork of the [OHIF Viewer](https://github.com/OHIF/Viewers), an extensible
open-source framework for web-based medical imaging. Most core viewer functionality comes from OHIF;
for general architecture, extensions, and modes, the [OHIF documentation](https://docs.ohif.org/) is
the best reference. We're grateful to the OHIF community — if OHIF helps your work, please cite:

> Open Health Imaging Foundation Viewer: An Extensible Open-Source Framework for Building Web-Based
> Imaging Applications to Support Cancer Research. Erik Ziegler, Trinity Urban, Danny Brown, et al.
> *JCO Clinical Cancer Informatics*, no. 4 (2020), 336-345.
> DOI: [10.1200/CCI.19.00131](https://www.doi.org/10.1200/CCI.19.00131)

## Contributing & support

- **Viewer source or image bugs and feature requests:** [open an issue in this repo](https://github.com/StratifAI-Research/odelia-viewer/issues).
- **General OHIF framework bugs and questions:** [open an issue on the OHIF board](https://github.com/OHIF/Viewers/issues).


## License

[MIT](LICENSE) — the source in this repository (OHIF core + ODELIA customizations) is MIT-licensed,
and this fork preserves the OHIF Viewer's copyright and license notice (© [OHIF](https://github.com/OHIF)).
Bundled third-party dependencies retain their own licenses.


## Intended use

**Research use only.** The ODELIA Viewer and its AI workflows are research software. They are **not a medical device**, are **not CE-marked or FDA-cleared**, and must **not be used for clinical diagnosis or patient care**.
