#!/usr/bin/env python3
"""
Build styles/terrain.json from openskimap.org's terrain_v2 style.

The openskimap basemap style is essentially a hand-tuned OpenMapTiles
style on top of free vector tiles (they use OpenFreeMap upstream) and
Mapterhorn DEM. This script downloads the style, strips the ski-data
source + its 40 layers (we render pistes/lifts from our own routing
graph), drops the low-zoom naturalearth backdrop, and repoints the
glyph + sprite urls to OpenFreeMap so the map renders without depending
on openskimap.org's tile server.

Run:
    python3 scripts/build_style.py

This regenerates styles/terrain.json from the current upstream.
"""
import json
import urllib.request
from pathlib import Path

UPSTREAM = "https://tiles.openskimap.org/styles/terrain_v2.json"
OUT      = Path(__file__).resolve().parent.parent / "styles" / "terrain.json"

DROP_SOURCES = {"openskimap", "naturalearth"}


def _swap_font(style: dict, src: str, dst: str) -> int:
    """Walk every layer's text-font property and replace `src` with `dst`."""
    n = 0
    for layer in style.get("layers", []):
        layout = layer.get("layout") or {}
        fonts = layout.get("text-font")
        if isinstance(fonts, list):
            new = [dst if f == src else f for f in fonts]
            if new != fonts:
                layout["text-font"] = new
                n += 1
    return n


def main() -> None:
    req = urllib.request.Request(
        UPSTREAM,
        headers={"User-Agent": "ski-home-map build-style.py (https://github.com/caldvs/ski-home-map)"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        style = json.load(r)

    for src in DROP_SOURCES:
        style["sources"].pop(src, None)

    before = len(style["layers"])
    style["layers"] = [
        L for L in style["layers"] if L.get("source") not in DROP_SOURCES
    ]
    print(f"stripped {before - len(style['layers'])} layers")

    style["glyphs"] = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"
    style["sprite"] = "https://tiles.openfreemap.org/sprites/ofm_f384/ofm"

    # OpenFreeMap's font server doesn't serve "Open Sans Semibold" — used by
    # a handful of openskimap labels. Substitute Noto Sans Bold so those
    # labels render. (Visually near-identical at typical map zoom levels.)
    _swap_font(style, "Open Sans Semibold", "Noto Sans Bold")

    style.setdefault("metadata", {})
    style["metadata"]["derived-from"] = (
        "openskimap.org terrain_v2 — basemap layers retained, ski-data "
        "sources/layers stripped, glyph+sprite urls repointed to OpenFreeMap."
    )
    style["id"] = "ski-home-terrain"

    OUT.write_text(json.dumps(style, indent=2))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {len(style['layers'])} layers)")


if __name__ == "__main__":
    main()
