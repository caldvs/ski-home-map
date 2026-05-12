#!/usr/bin/env python3
"""
Audit every data/*.json for nodes that share a name but are in different
forward-reachable subgraphs — a strong signal that the upstream graph
builder split a single physical lift station / piste endpoint into two
separate places. Each such pair is a candidate for an override that
merges them or bridges them.

Run:
    python3 scripts/audit_duplicates.py
"""
from __future__ import annotations

import json
import math
from collections import defaultdict, deque
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def reachable_fwd(start, fwd_adj, limit=10000):
    seen = {start}
    q = deque([start])
    while q and len(seen) < limit:
        u = q.popleft()
        for v in fwd_adj.get(u, ()):
            if v not in seen:
                seen.add(v)
                q.append(v)
    return seen


def haversine(a, b):
    R = 6371000
    lat1, lon1 = math.radians(a["lat"]), math.radians(a["lon"])
    lat2, lon2 = math.radians(b["lat"]), math.radians(b["lon"])
    s = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(s))


def audit_graph(path: Path) -> list:
    g = json.loads(path.read_text())
    nodes = g["nodes"]
    by_id = {n["id"]: n for n in nodes}

    fwd = defaultdict(list)
    for e in g["edges"]:
        fwd[e["from"]].append(e["to"])

    # Compute forward-reachable size for each node, deduped by fingerprint
    fingerprint_of = {}
    size_of = {}
    for n in nodes:
        nid = n["id"]
        r = reachable_fwd(nid, fwd)
        fp = frozenset(r)
        fingerprint_of[nid] = fp
        size_of[nid] = len(r)

    # Group nodes by name
    by_name = defaultdict(list)
    for n in nodes:
        if n.get("name"):
            by_name[n["name"]].append(n["id"])

    findings = []
    for name, ids in by_name.items():
        if len(ids) < 2:
            continue
        # Same name, two+ different forward-reachable fingerprints
        # → likely a split
        groups = defaultdict(list)
        for nid in ids:
            groups[fingerprint_of[nid]].append(nid)
        if len(groups) < 2:
            continue  # all in same component — fine

        # Format finding
        sizes_str = " vs ".join(
            str(size_of[grp[0]]) for grp in groups.values()
        )
        elev_strs = [
            f"{by_id[grp[0]]['elev']:.0f}m"
            for grp in groups.values()
        ]
        # Distance between the two "main" groups (largest pair)
        sorted_groups = sorted(groups.values(), key=lambda g: -size_of[g[0]])
        a = by_id[sorted_groups[0][0]]
        b = by_id[sorted_groups[1][0]]
        dist = haversine(a, b)

        findings.append({
            "world": path.stem,
            "name": name,
            "n_groups": len(groups),
            "sizes": sizes_str,
            "elevs": ", ".join(elev_strs),
            "distance_m": int(dist),
            "ids_per_group": [list(grp) for grp in sorted_groups],
        })
    return findings


def main():
    paths = sorted(DATA_DIR.glob("*.json"))
    all_findings = []
    for p in paths:
        findings = audit_graph(p)
        if not findings:
            continue
        print(f"\n=== {p.stem} ===")
        # Sort: biggest gap first (closest physical distance = most-likely
        # genuine duplicates; same-name far-apart pairs are often
        # legitimate separate features named the same)
        findings.sort(key=lambda f: f["distance_m"])
        for f in findings:
            print(f"  '{f['name']}'  ({f['n_groups']} groups)")
            print(f"    sizes (forward-reach): {f['sizes']}")
            print(f"    elevs:                 {f['elevs']}")
            print(f"    distance between top-2 groups: {f['distance_m']}m")
            print(f"    ids per group:         {f['ids_per_group']}")
        all_findings.extend(findings)

    # Final priority summary: name+world where one group is small (orphan-ish)
    # and the other is large — those are the worst data bugs.
    print("\n\n=== Priority cases (one group < 20 nodes, other > 100) ===")
    by_priority = []
    for f in all_findings:
        sizes = [int(s) for s in f["sizes"].split(" vs ")]
        if min(sizes) < 20 and max(sizes) > 100:
            by_priority.append((max(sizes) - min(sizes), f))
    by_priority.sort(key=lambda x: -x[0])
    for _gap, f in by_priority:
        print(f"  {f['world']:25s}  '{f['name']}'  sizes {f['sizes']}, dist {f['distance_m']}m, elevs {f['elevs']}")


if __name__ == "__main__":
    main()
