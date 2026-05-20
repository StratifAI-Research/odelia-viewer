"""Tests for the Python-lint composite action's summary renderer."""

import json
import os
import sys
from pathlib import Path

import pytest


ACTION_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ACTION_DIR))

import render_summary  # noqa: E402


FIXTURES = Path(__file__).parent / "fixtures"


def test_render_summary_writes_outputs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Given fixture inputs, render_summary writes summary.md and metadata.json."""
    monkeypatch.setenv("PYTHON_LINT_WARN_ONLY", "true")

    outputs = tmp_path / "outputs"
    outputs.mkdir()
    (outputs / "ruff.json").write_text((FIXTURES / "ruff.json").read_text())
    (outputs / "ruff-format.txt").write_text((FIXTURES / "ruff-format.txt").read_text())
    (outputs / "mypy.txt").write_text((FIXTURES / "mypy.txt").read_text())

    os.chdir(tmp_path)
    render_summary.main()

    summary = (outputs / "summary.md").read_text()
    metadata = json.loads((outputs / "metadata.json").read_text())

    assert "## Lint PY (ruff)" in summary
    assert "## Lint PY (ruff format)" in summary
    assert "## Lint PY (mypy)" in summary
    assert metadata["tool"] == "python-lint-suite"
    assert "ruff_version" in metadata
    assert "mypy_version" in metadata


def test_render_summary_handles_empty_outputs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Missing or empty output files don't crash; summary reports zero violations."""
    monkeypatch.setenv("PYTHON_LINT_WARN_ONLY", "true")

    outputs = tmp_path / "outputs"
    outputs.mkdir()
    (outputs / "ruff.json").write_text("[]")
    (outputs / "ruff-format.txt").write_text("")
    (outputs / "mypy.txt").write_text("Success: no issues found in 0 source files\n")

    os.chdir(tmp_path)
    render_summary.main()

    summary = (outputs / "summary.md").read_text()
    assert "Total violations: **0**" in summary


def test_main_exits_nonzero_when_violations_and_gating(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Gating mode exits 1 when any tool reports violations."""
    monkeypatch.delenv("PYTHON_LINT_WARN_ONLY", raising=False)

    outputs = tmp_path / "outputs"
    outputs.mkdir()
    (outputs / "ruff.json").write_text((FIXTURES / "ruff.json").read_text())
    (outputs / "ruff-format.txt").write_text((FIXTURES / "ruff-format.txt").read_text())
    (outputs / "mypy.txt").write_text((FIXTURES / "mypy.txt").read_text())

    os.chdir(tmp_path)
    with pytest.raises(SystemExit) as exc_info:
        render_summary.main()
    assert exc_info.value.code == 1


def test_main_exits_zero_when_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Gating mode exits 0 when all tools report zero violations."""
    monkeypatch.delenv("PYTHON_LINT_WARN_ONLY", raising=False)

    outputs = tmp_path / "outputs"
    outputs.mkdir()
    (outputs / "ruff.json").write_text("[]")
    (outputs / "ruff-format.txt").write_text("")
    (outputs / "mypy.txt").write_text("Success: no issues found in 0 source files\n")

    os.chdir(tmp_path)
    # Should not raise — no violations means exit 0 (main() returns normally)
    render_summary.main()
