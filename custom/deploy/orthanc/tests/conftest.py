import pytest


def pytest_collection_modifyitems(config, items):
    orphans = []
    for item in items:
        p = str(item.path).replace("\\", "/")
        marks = {m.name for m in item.iter_markers()}
        if "unit" in marks or "integration" in marks:
            continue
        if "/tests/unit/" in p:
            item.add_marker(pytest.mark.unit)
        elif "/tests/integration/" in p:
            item.add_marker(pytest.mark.integration)
        else:
            orphans.append(p)
    if orphans:
        raise pytest.UsageError(
            "Tests outside tests/unit/ and tests/integration/ must carry an explicit "
            "@pytest.mark.unit or @pytest.mark.integration. Offenders:\n  "
            + "\n  ".join(orphans)
        )
