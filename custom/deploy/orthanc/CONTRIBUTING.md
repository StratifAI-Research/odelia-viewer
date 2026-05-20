# Contributing to platform Python services

## Local development

Each service has its own `pyproject.toml` (direct deps) and `requirements.txt` (hand-pinned, no hashes).

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

1. Edit `<service>/pyproject.toml` — add or modify an entry in `[project].dependencies`. Always use `==X.Y.Z` (or `pkg @ git+url@<sha>` for git deps).
2. Edit `<service>/requirements.txt` to match — the two files are kept lockstep by hand.
3. CI's `python-pin-check` job verifies both files are fully pinned and agree on versions. Unpinned entries (`>=`, no operator) fail the check.
