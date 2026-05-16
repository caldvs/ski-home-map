"""Per-world graph invariants.

Catches the bugs that put a world in "needs-data" status:
  - village → village unreachability
  - dangling edge endpoints
  - bad coordinates / elevations
  - empty graphs

Worlds flagged `status: "needs-data"` in worlds.js are marked xfail —
they're expected to fail today. When you fix one via overrides, flip its
status to "built" and the xfail becomes a hard requirement.

These tests do not require skiroute or any other dependency beyond
stdlib + pytest. Reachability uses a plain BFS over directed edges.
"""

from __future__ import annotations

import math
from collections import defaultdict, deque
from pathlib import Path

import pytest

from conftest import DATA_DIR, load_graph


# ───────────────────────────────────────────────────────────────────────
# Schema sanity
# ───────────────────────────────────────────────────────────────────────


def test_data_file_exists(world_slug, world_status):
    path = DATA_DIR / f"{world_slug}.json"
    assert path.exists(), f"missing data/{world_slug}.json"


def test_top_level_shape(world_slug, world_status):
    g = load_graph(world_slug)
    assert isinstance(g, dict)
    for key in ("nodes", "edges", "villages"):
        assert key in g, f"missing top-level key {key!r}"
    assert isinstance(g["nodes"], list) and g["nodes"], "no nodes"
    assert isinstance(g["edges"], list) and g["edges"], "no edges"
    assert isinstance(g["villages"], dict) and g["villages"], "no villages"


def test_node_coordinates_in_range(world_slug, world_status):
    g = load_graph(world_slug)
    for n in g["nodes"]:
        assert -90 <= n["lat"] <= 90, f"bad lat {n['lat']} on node {n['id']}"
        assert -180 <= n["lon"] <= 180, f"bad lon {n['lon']} on node {n['id']}"
        elev = n.get("elev")
        if elev is not None:
            assert not math.isnan(elev), f"NaN elev on node {n['id']}"
            assert 0 <= elev <= 5000, f"absurd elev {elev} on node {n['id']}"


def test_edges_reference_existing_nodes(world_slug, world_status):
    g = load_graph(world_slug)
    ids = {n["id"] for n in g["nodes"]}
    for e in g["edges"]:
        assert e["from"] in ids, f"edge from {e['from']!r} not in nodes"
        assert e["to"] in ids, f"edge to {e['to']!r} not in nodes"


def test_edge_costs_finite_and_positive(world_slug, world_status):
    g = load_graph(world_slug)
    for e in g["edges"]:
        c = e.get("cost_base")
        assert c is not None, f"missing cost_base on edge {e['from']}→{e['to']}"
        assert not math.isnan(c), f"NaN cost on edge {e['from']}→{e['to']}"
        assert c >= 0, f"negative cost {c} on edge {e['from']}→{e['to']}"


# Note: we intentionally do NOT assert that every village name appears in
# some node's `villages` field. Many built worlds route to villages via
# coordinate snap at query time rather than baking the village name into
# nodes — both approaches are valid.


# ───────────────────────────────────────────────────────────────────────
# Connectivity — the headline "needs-data" check
# ───────────────────────────────────────────────────────────────────────


def _adjacency(graph: dict) -> dict[str, list[str]]:
    adj: dict[str, list[str]] = defaultdict(list)
    for e in graph["edges"]:
        adj[e["from"]].append(e["to"])
    return adj


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _village_node_ids(graph: dict, village: str) -> list[str]:
    """All node ids belonging to `village` — first by explicit `node.villages`
    tag, falling back to a 500 m radius snap from the village coordinate.
    Snap matches how the live router associates a destination coord with
    the graph at query time."""
    tagged = [
        n["id"]
        for n in graph["nodes"]
        if village in (n.get("villages") or [])
    ]
    if tagged:
        return tagged
    meta = graph["villages"].get(village)
    if not meta or "lat" not in meta or "lon" not in meta:
        return []
    vlat, vlon = meta["lat"], meta["lon"]
    snapped = [
        n["id"]
        for n in graph["nodes"]
        if _haversine_m(vlat, vlon, n["lat"], n["lon"]) <= 500
    ]
    return snapped


def _reachable_set(adj: dict[str, list[str]], starts: list[str]) -> set[str]:
    seen = set(starts)
    queue = deque(starts)
    while queue:
        node = queue.popleft()
        for nxt in adj.get(node, ()):
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return seen


def test_every_village_pair_reachable(world_slug, world_status):
    """For every (A, B) village pair, at least one node of A reaches at least
    one node of B via directed edges. Captures the core "can I ski home"
    question independent of the specific routing algorithm."""
    g = load_graph(world_slug)
    adj = _adjacency(g)
    village_nodes = {v: _village_node_ids(g, v) for v in g["villages"]}
    unreachable = []
    for src, src_ids in village_nodes.items():
        if not src_ids:
            continue
        reach = _reachable_set(adj, src_ids)
        for dst, dst_ids in village_nodes.items():
            if src == dst or not dst_ids:
                continue
            if not (reach & set(dst_ids)):
                unreachable.append(f"{src} → {dst}")
    assert not unreachable, (
        f"{len(unreachable)} unreachable village pairs in {world_slug}: "
        + "; ".join(unreachable[:8])
        + (f"  …(+{len(unreachable) - 8} more)" if len(unreachable) > 8 else "")
    )


def test_largest_scc_covers_most_nodes(world_slug, world_status):
    """Heuristic: the biggest strongly-connected component should hold the
    majority of nodes. A world where the largest SCC is < 50% of nodes is
    fragmented — usually a sign of missing skating bridges."""
    g = load_graph(world_slug)
    # Tarjan SCC — iterative to avoid recursion-depth pitfalls on big graphs.
    adj = _adjacency(g)
    nodes = [n["id"] for n in g["nodes"]]
    index_of: dict[str, int] = {}
    lowlink: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    sccs: list[list[str]] = []
    counter = [0]

    def strongconnect(root: str) -> None:
        work = [(root, iter(adj.get(root, ())))]
        index_of[root] = counter[0]
        lowlink[root] = counter[0]
        counter[0] += 1
        stack.append(root)
        on_stack.add(root)
        while work:
            v, it = work[-1]
            try:
                w = next(it)
                if w not in index_of:
                    index_of[w] = counter[0]
                    lowlink[w] = counter[0]
                    counter[0] += 1
                    stack.append(w)
                    on_stack.add(w)
                    work.append((w, iter(adj.get(w, ()))))
                elif w in on_stack:
                    lowlink[v] = min(lowlink[v], index_of[w])
            except StopIteration:
                work.pop()
                if lowlink[v] == index_of[v]:
                    comp = []
                    while True:
                        u = stack.pop()
                        on_stack.discard(u)
                        comp.append(u)
                        if u == v:
                            break
                    sccs.append(comp)
                if work:
                    parent = work[-1][0]
                    lowlink[parent] = min(lowlink[parent], lowlink[v])

    for n in nodes:
        if n not in index_of:
            strongconnect(n)

    biggest = max(len(c) for c in sccs)
    ratio = biggest / len(nodes)
    assert ratio >= 0.5, (
        f"{world_slug}: largest SCC covers only {biggest}/{len(nodes)} "
        f"nodes ({ratio:.0%}) — graph is fragmented. {len(sccs)} components total."
    )
