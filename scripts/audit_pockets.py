#!/usr/bin/env python3
"""
Audit every data/*.json graph for orphan pockets — small clusters of
nodes that the directed Dijkstra can't escape (forward orphans) or
that the wider graph can't reach (reverse orphans).

For each graph:
  1. Build forward + reverse adjacency from the directed edges.
  2. For each node, BFS forward (and reverse) up to a probe limit.
  3. Group nodes by their reachable-set fingerprint so each pocket
     appears once. Print a human report for pockets smaller than
     a threshold.

Run:
    python3 scripts/audit_pockets.py
    python3 scripts/audit_pockets.py --threshold 30 --only les-arcs
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict, deque
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def build_adj(graph):
    """Return (fwd, rev) as dict[node_id] → list[neighbour_id]."""
    fwd = defaultdict(list)
    rev = defaultdict(list)
    for e in graph["edges"]:
        fwd[e["from"]].append(e["to"])
        rev[e["to"]].append(e["from"])
    return fwd, rev


def reachable(start, adj, limit):
    seen = {start}
    q = deque([start])
    while q and len(seen) < limit:
        u = q.popleft()
        for v in adj.get(u, ()):
            if v not in seen:
                seen.add(v)
                q.append(v)
    return seen


def find_pockets(graph, adj, threshold):
    """Group nodes by their reachable-set; return pockets smaller than threshold."""
    limit = threshold + 1
    # Compute reachable sets once per "representative" — we walk nodes in
    # order, and if a node already appeared as a member of an earlier
    # reachable set OF THE SAME SIZE, skip recomputing for it (cheap dedupe).
    by_size: dict[tuple, set[int]] = {}
    node_ids = [n["id"] for n in graph["nodes"]]
    for nid in node_ids:
        r = reachable(nid, adj, limit)
        if len(r) > threshold:
            continue
        key = frozenset(r)
        by_size.setdefault(key, r)
    return list(by_size.values())


def fmt_pocket(graph, nodes):
    nodes_by_id = {n["id"]: n for n in graph["nodes"]}
    elevs = sorted(round(nodes_by_id[i]["elev"]) for i in nodes)
    lines = [f"  {len(nodes)}-node pocket, elev {elevs[0]}..{elevs[-1]}m:"]
    for nid in sorted(nodes, key=lambda i: nodes_by_id[i]["elev"]):
        n = nodes_by_id[nid]
        name = n.get("name") or f"(unnamed node {nid})"
        lines.append(f"    {nid:4d}  {n['elev']:>5.0f}m  {name}")
    return "\n".join(lines)


def audit_graph(path: Path, threshold: int) -> None:
    graph = json.loads(path.read_text())
    nodes = graph["nodes"]
    edges = graph["edges"]
    fwd, rev = build_adj(graph)

    fwd_pockets = find_pockets(graph, fwd, threshold)
    rev_pockets = find_pockets(graph, rev, threshold)

    name = path.stem
    print(f"\n=== {name} ({len(nodes)} nodes, {len(edges)} edges) ===")
    if not fwd_pockets and not rev_pockets:
        print("  ✓ no orphan pockets below threshold")
        return

    if fwd_pockets:
        print(f"  FORWARD-orphan pockets (start here → can't escape):")
        for p in sorted(fwd_pockets, key=len):
            print(fmt_pocket(graph, p))
    if rev_pockets:
        print(f"  REVERSE-orphan pockets (graph → can't ski into here):")
        for p in sorted(rev_pockets, key=len):
            print(fmt_pocket(graph, p))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=int, default=25,
                    help="Pocket-size cutoff. Nodes whose reachable set is at "
                         "most this many are flagged (default: 25).")
    ap.add_argument("--only", help="Audit just one world (e.g. les-arcs).")
    args = ap.parse_args()

    paths = sorted(DATA_DIR.glob("*.json"))
    if args.only:
        paths = [p for p in paths if p.stem == args.only]
        if not paths:
            raise SystemExit(f"no data/{args.only}.json")

    for p in paths:
        audit_graph(p, args.threshold)


if __name__ == "__main__":
    main()
