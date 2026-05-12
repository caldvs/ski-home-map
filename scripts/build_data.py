"""Rebuild the data/*.json graph files from the OpenSkiData GeoPackage.

This is the only Python in the project — it runs ahead of deploy to
produce static JSON graphs. The map itself is pure browser-side JS.

Usage:
    pip install skiroute
    SKIROUTE_GPKG=/path/to/openskidata.gpkg python3 scripts/build_data.py

Add new worlds by appending to WORLDS below. After running, commit
the updated data/*.json files.
"""

from __future__ import annotations

import os
from pathlib import Path

import skiroute


GPKG = Path(os.environ.get("SKIROUTE_GPKG", "openskidata.gpkg"))
OUT_DIR = Path(__file__).parent.parent / "data"


# -------------------------------------------------------------------
# Single-resort worlds
# -------------------------------------------------------------------

TIGNES_DESTINATIONS = [
    skiroute.Destination("Tignes Val Claret",     lat=45.4510, lon=6.9000, radius_m=450, elev=2100),
    skiroute.Destination("Tignes Le Lac",         lat=45.4680, lon=6.9070, radius_m=500, elev=2100),
    skiroute.Destination("Tignes Les Boisses",    lat=45.4975, lon=6.9230, radius_m=500, elev=1800),
    skiroute.Destination("Tignes Les Brevieres",  lat=45.5080, lon=6.9210, radius_m=500, elev=1550),
    skiroute.Destination("Val d'Isere La Daille", lat=45.4608, lon=6.9638, radius_m=500, elev=1800),
    skiroute.Destination("Val d'Isere Centre",    lat=45.4490, lon=6.9810, radius_m=500, elev=1850),
    skiroute.Destination("Val d'Isere Le Fornet", lat=45.4500, lon=7.0110, radius_m=500, elev=1930),
]


def build_tignes() -> skiroute.Graph:
    return skiroute.build_graph(
        gpkg_path=GPKG,
        resort=skiroute.ResortFilter(ski_area_pattern="%Tignes - Val%"),
        destinations=TIGNES_DESTINATIONS,
        verbose=False,
    )


# -------------------------------------------------------------------
# Multi-resort worlds (stitched)
# -------------------------------------------------------------------
# These would import skiroute.stitch.{Connector, stitch_graphs} once
# we've shipped a release that includes them. For the initial deployment
# only Tignes is built — uncomment and run when ready for the stitched
# worlds.

WORLDS = {
    "tignes": build_tignes,
    # "tignes-three-valleys": build_tignes_three_valleys,
    # "savoie-16":             build_savoie_16,
}


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    if not GPKG.exists():
        print(f"GeoPackage not found at {GPKG}.")
        print("Set SKIROUTE_GPKG=/path/to/openskidata.gpkg or drop it next to this script.")
        print("Download: https://openskidata.org/")
        return

    for name, builder in WORLDS.items():
        print(f"Building world: {name}")
        g = builder()
        out_path = OUT_DIR / f"{name}.json"
        g.save(out_path)
        size_mb = out_path.stat().st_size / 1_048_576
        print(f"  → {out_path}  ({g}, {size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
