"""Verify pyproject.toml [project].dependencies and requirements.txt are lockstep pinned.

For each service directory, both files must:
  - Have every entry fully pinned (== for PyPI, @ git+...@<sha> for git URLs).
  - Contain the same set of direct deps with identical version specs.

Exits 1 if any service fails either check.
"""

from __future__ import annotations

import re
import sys
import tomllib
from pathlib import Path

SERVICES = [
    "viewer",
    "router",
    "MLIntegration/shared",
    "MLIntegration/medgemma-mri",
    "MLIntegration/MST-classification",
    "MLIntegration/chat-middleware",
    "MLIntegration/breast-cancer-classification",
]

# A dep line is "pinned" if it has `==<version>` (with optional whitespace)
# OR is a git URL with a commit SHA: `pkg @ git+url@<sha>`.
PINNED_PYPI = re.compile(r"^[A-Za-z0-9_.\-]+\s*==\s*[^\s]+$")
PINNED_GIT = re.compile(r"^[A-Za-z0-9_.\-]+\s*@\s*git\+\S+@[0-9a-f]{7,}$")


def is_pinned(entry: str) -> bool:
    entry = entry.strip()
    return bool(PINNED_PYPI.match(entry) or PINNED_GIT.match(entry))


def read_pyproject_deps(path: Path) -> list[str]:
    with open(path, "rb") as f:
        data = tomllib.load(f)
    return data.get("project", {}).get("dependencies", [])


def read_requirements(path: Path) -> list[str]:
    return [
        line.strip()
        for line in path.read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def main() -> int:
    failed = False
    for svc in SERVICES:
        pyproject_path = Path(svc) / "pyproject.toml"
        requirements_path = Path(svc) / "requirements.txt"

        if not pyproject_path.exists():
            print(f"::warning::{svc} has no pyproject.toml, skipping")
            continue
        if not requirements_path.exists():
            print(f"::error file={requirements_path}::missing requirements.txt")
            failed = True
            continue

        py_deps = read_pyproject_deps(pyproject_path)
        req_deps = read_requirements(requirements_path)

        for entry in py_deps:
            if not is_pinned(entry):
                print(
                    f"::error file={pyproject_path}::unpinned dep in pyproject.toml: {entry!r}"
                )
                failed = True

        for entry in req_deps:
            if not is_pinned(entry):
                print(
                    f"::error file={requirements_path}::unpinned dep in requirements.txt: {entry!r}"
                )
                failed = True

        if sorted(py_deps) != sorted(req_deps):
            print(
                f"::error::pyproject.toml and requirements.txt disagree in {svc}\n"
                f"  pyproject only: {sorted(set(py_deps) - set(req_deps))}\n"
                f"  requirements only: {sorted(set(req_deps) - set(py_deps))}"
            )
            failed = True

        if not failed:
            print(f"✓ {svc}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
