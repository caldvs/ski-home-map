"""Test fixtures shared by the graph-invariant suite.

Reads the world catalogue out of `js/worlds.js` so the test list stays in
lock-step with whatever the dashboard advertises. Each world is yielded
with its declared status ("built" / "planned" / "needs-data") — tests
decide what to assert based on that.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterator

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
WORLDS_JS = REPO_ROOT / "js" / "worlds.js"


# A world entry in worlds.js looks roughly like:
#
#   tignes: {
#     id: "tignes",
#     ...
#     status: "built",
#     ...
#   },
#
# We don't try to parse JS — we just regex out `id: "<slug>"` and the
# matching `status: "<state>"`. Order matters: id appears just above
# status inside the same entry.
_ID_RE = re.compile(r'\bid:\s*"([^"]+)"')
_STATUS_RE = re.compile(r'\bstatus:\s*"([^"]+)"')


def _parse_worlds_js() -> list[tuple[str, str]]:
    """Return [(slug, status), …] in declaration order."""
    text = WORLDS_JS.read_text()
    ids = [(m.start(), m.group(1)) for m in _ID_RE.finditer(text)]
    statuses = [(m.start(), m.group(1)) for m in _STATUS_RE.finditer(text)]
    if len(ids) != len(statuses):
        raise RuntimeError(
            f"worlds.js id/status mismatch: {len(ids)} ids vs "
            f"{len(statuses)} statuses — fix the regex or the file."
        )
    return [(slug, status) for (_, slug), (_, status) in zip(ids, statuses)]


WORLDS: list[tuple[str, str]] = _parse_worlds_js()
BUILT_WORLDS: list[str] = [s for s, st in WORLDS if st == "built"]
NEEDS_DATA_WORLDS: list[str] = [s for s, st in WORLDS if st == "needs-data"]
PLANNED_WORLDS: list[str] = [s for s, st in WORLDS if st == "planned"]


def load_graph(slug: str) -> dict:
    return json.loads((DATA_DIR / f"{slug}.json").read_text())


@pytest.fixture(scope="session")
def worlds_index() -> list[tuple[str, str]]:
    return WORLDS


def world_param(slug: str, status: str):
    """Param-id helper so pytest -k filters on the world slug."""
    marks = []
    if status == "needs-data":
        marks.append(pytest.mark.xfail(
            reason="world is flagged status:'needs-data' — fix via overrides and flip to 'built'",
            strict=False,
        ))
    elif status == "planned":
        marks.append(pytest.mark.skip(reason="status:'planned' — graph not built yet"))
    return pytest.param(slug, status, id=slug, marks=marks)


def pytest_generate_tests(metafunc):
    if "world_slug" in metafunc.fixturenames and "world_status" in metafunc.fixturenames:
        metafunc.parametrize(
            ("world_slug", "world_status"),
            [world_param(s, st) for s, st in WORLDS],
        )
