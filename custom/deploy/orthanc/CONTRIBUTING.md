# Contributing to platform Python services

## Local development

Each service has its own `pyproject.toml` (direct deps) and `requirements.txt` (compiled, hashed).

### Install dev tools (ruff, mypy)

```
pip install -r requirements-dev.txt
```

### Run linters locally

```
cd custom/deploy/orthanc  # or /orthanc inside the platform repo
ruff check .
ruff format --check .
mypy viewer router MLIntegration/shared
```

## Adding or updating a dependency

1. Edit `<service>/pyproject.toml` — add/modify the entry in `[project].dependencies`.
2. Regenerate the pinned lockfile:

```
cd <service>
uv pip compile pyproject.toml -o requirements.txt --generate-hashes
```

3. Commit both `pyproject.toml` and `requirements.txt`. A CI lockfile-sync job will block the PR if these drift (lands later in ODV-191 — until then, eyeball the diff before committing).

## Why not `uv.lock`?

Deploy target is Docker. Dockerfiles consume `requirements.txt` directly; `uv.lock` would be a parallel format with no consumer. Hashed `requirements.txt` gives us reproducible builds and accurate SBOMs without changing Dockerfiles.
