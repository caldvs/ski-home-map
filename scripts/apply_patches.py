#!/usr/bin/env python3
"""
Apply per-world graph patches to data/*.json.

Reads scripts/patches.json (a config keyed by world slug) and modifies
each affected graph in place. Run this after scripts/build_data.py.

Today's only operation is `add_edges`, which inserts an edge between
two nodes selected by (name, elev). The elev is required because the
upstream OpenSkiData sometimes produces two same-named nodes at
different elevations (the very bug this script exists to work around).

Run:
    python3 scripts/apply_patches.py
    python3 scripts/apply_patches.py --only les-arcs
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ROOT      = Path(__file__).resolve().parent.parent
DATA_DIR  = ROOT / "data"
PATCHES   = ROOT / "scripts" / "patches.json"


def haversine(a, b):
    R = 6371000
    lat1, lon1 = math.radians(a["lat"]), math.radians(a["lon"])
    lat2, lon2 = math.radians(b["lat"]), math.radians(b["lon"])
    s = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(s))


def find_node(nodes, name, elev, elev_tolerance=20):
    """Return the (unique) node id matching name and elev (within tolerance)."""
    matches = [
        n for n in nodes
        if n.get("name") == name and abs(n["elev"] - elev) <= elev_tolerance
    ]
    if not matches:
        raise SystemExit(
            f"  patches: no node named {name!r} at elev ~{elev}m"
        )
    if len(matches) > 1:
        elevs = [f"{m['elev']:.0f}m" for m in matches]
        raise SystemExit(
            f"  patches: ambiguous — {len(matches)} nodes named {name!r} "
            f"at elevs {elevs} (tighten elev_tolerance or pick a unique one)"
        )
    return matches[0]


def apply_patch_to_graph(graph, world_patch):
    """Apply one world's patches to a loaded graph dict. Returns count of edges added."""
    nodes = graph["nodes"]
    edges = graph["edges"]
    added = 0
    for spec in world_patch.get("add_edges", []):
        if spec.get("_example") or spec.get("_note"):
            # `_note` is descriptive, not a skip marker — but `_example: true` is
            if spec.get("_example"):
                continue
        a = find_node(nodes, spec["from_name"], spec["from_elev"])
        b = find_node(nodes, spec["to_name"], spec["to_elev"])
        length = haversine(a, b)
        edge = {
            "from": a["id"],
            "to": b["id"],
            "type": spec.get("type", "skate"),
            "name": spec.get("name", f"patch:{a['name']}->{b['name']}"),
            "cost_base": float(spec["cost_base"]),
            "length_m": round(length, 1),
            "elev_drop": round(a["elev"] - b["elev"], 1),
            "geometry": [[a["lon"], a["lat"]], [b["lon"], b["lat"]]],
        }
        if "lift_type" in spec:
            edge["lift_type"] = spec["lift_type"]
        if "difficulty" in spec:
            edge["difficulty"] = spec["difficulty"]
        edges.append(edge)
        added += 1
        print(f"    + {edge['type']:10s} {a['name']} ({a['elev']:.0f}m) → "
              f"{b['name']} ({b['elev']:.0f}m), {int(length)}m, cost {edge['cost_base']:.0f}s")
    return added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="patch just one world (slug)")
    args = ap.parse_args()

    with PATCHES.open() as f:
        patches = json.load(f)

    for slug, patch in patches.items():
        if slug.startswith("_"):
            continue
        if args.only and slug != args.only:
            continue
        path = DATA_DIR / f"{slug}.json"
        if not path.exists():
            print(f"  patches: skipping {slug} — no data/{slug}.json")
            continue
        graph = json.loads(path.read_text())
        print(f"  patching {slug}:")
        n = apply_patch_to_graph(graph, patch)
        path.write_text(json.dumps(graph))
        print(f"  → +{n} edges, wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
