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

1. Edit `<service>/pyproject.toml` — modify `[project].dependencies`.
2. Edit `<service>/requirements.txt` to match. The two files are kept in sync by hand. Both are committed.
3. Pyproject.toml is the source of truth for direct deps; requirements.txt is what Dockerfiles consume.
