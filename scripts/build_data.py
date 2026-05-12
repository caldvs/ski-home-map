"""Rebuild the data/*.json graph files from the OpenSkiData GeoPackage.

This is the only Python in the project — it runs ahead of deploy to
produce static JSON graphs. The map itself is pure browser-side JS.

Usage:
    pip install skiroute
    SKIROUTE_GPKG=/path/to/openskidata.gpkg python3 scripts/build_data.py

Builds 16 standalone Savoie resorts (one JSON each). Experimental
stitched worlds were removed — see note further down.

Add new worlds by appending to SINGLE_RESORT_SLUGS + RESORTS.
"""

from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import skiroute
from skiroute.stitch import Connector, auto_piste_connectors, stitch_graphs


GPKG = Path(os.environ.get("SKIROUTE_GPKG", "openskidata.gpkg"))
OUT_DIR = Path(__file__).parent.parent / "data"


# ---------------------------------------------------------------------------
# Resort definitions — one row per real OpenSkiData ski area.
# Each row's `pattern` is a SQL LIKE against ski_area_names.
# ---------------------------------------------------------------------------


@dataclass
class ResortSpec:
    name: str
    pattern: str
    destinations: list = field(default_factory=list)


RESORTS: list[ResortSpec] = [
    ResortSpec(  # 0 TIGNES
        name="Tignes / Val d'Isère",
        pattern="%Tignes - Val%",
        destinations=[
            skiroute.Destination("Tignes Val Claret",     lat=45.4510, lon=6.9000, radius_m=450, elev=2100),
            skiroute.Destination("Tignes Le Lac",         lat=45.4680, lon=6.9070, radius_m=500, elev=2100),
            skiroute.Destination("Tignes Les Boisses",    lat=45.4975, lon=6.9230, radius_m=500, elev=1800),
            skiroute.Destination("Tignes Les Brevieres",  lat=45.5080, lon=6.9210, radius_m=500, elev=1550),
            skiroute.Destination("Val d'Isere La Daille", lat=45.4608, lon=6.9638, radius_m=500, elev=1800),
            skiroute.Destination("Val d'Isere Centre",    lat=45.4490, lon=6.9810, radius_m=500, elev=1850),
            skiroute.Destination("Val d'Isere Le Fornet", lat=45.4500, lon=7.0110, radius_m=500, elev=1930),
        ],
    ),
    ResortSpec(  # 1 TROIS_VALLEES
        name="Les Trois Vallées",
        pattern="%Trois Vallées%",
        destinations=[
            skiroute.Destination("Val Thorens",                lat=45.2974, lon=6.5800, radius_m=600, elev=2300),
            skiroute.Destination("Les Menuires",               lat=45.3265, lon=6.5390, radius_m=600, elev=1850),
            skiroute.Destination("Saint Martin de Belleville", lat=45.3760, lon=6.5140, radius_m=500, elev=1450),
            skiroute.Destination("Méribel",                    lat=45.3910, lon=6.5660, radius_m=600, elev=1450),
            skiroute.Destination("Méribel-Mottaret",           lat=45.3570, lon=6.5750, radius_m=500, elev=1750),
            skiroute.Destination("Courchevel 1850",            lat=45.4130, lon=6.6380, radius_m=600, elev=1850),
            skiroute.Destination("Courchevel Moriond",         lat=45.4050, lon=6.6580, radius_m=500, elev=1650),
            skiroute.Destination("Courchevel Le Praz",         lat=45.4280, lon=6.6330, radius_m=500, elev=1300),
            skiroute.Destination("La Tania",                   lat=45.4280, lon=6.6250, radius_m=400, elev=1400),
            skiroute.Destination("Orelle",                     lat=45.2350, lon=6.5550, radius_m=500, elev=900),
        ],
    ),
    ResortSpec(  # 2 ARCS
        name="Les Arcs",
        pattern="%Les Arcs%",
        destinations=[
            skiroute.Destination("Arc 1950",         lat=45.5790, lon=6.7720, radius_m=400, elev=1950),
            skiroute.Destination("Arc 2000",         lat=45.5840, lon=6.7900, radius_m=400, elev=2000),
            skiroute.Destination("Arc 1800",         lat=45.6010, lon=6.7800, radius_m=500, elev=1800),
            skiroute.Destination("Arc 1600",         lat=45.6160, lon=6.8060, radius_m=400, elev=1600),
            skiroute.Destination("Peisey-Vallandry", lat=45.5500, lon=6.7820, radius_m=500, elev=1600),
        ],
    ),
    ResortSpec(  # 3 PLAGNE
        name="La Plagne",
        pattern="%La Plagne%",
        destinations=[
            skiroute.Destination("Plagne Centre",        lat=45.5070, lon=6.6850, radius_m=400, elev=1970),
            skiroute.Destination("Plagne Bellecôte",     lat=45.5180, lon=6.6920, radius_m=400, elev=1930),
            skiroute.Destination("Belle Plagne",         lat=45.5210, lon=6.6990, radius_m=400, elev=2050),
            skiroute.Destination("Aime 2000",            lat=45.5110, lon=6.7000, radius_m=400, elev=2100),
            skiroute.Destination("Plagne Villages",      lat=45.5050, lon=6.6960, radius_m=400, elev=2050),
            skiroute.Destination("Plagne 1800",          lat=45.4990, lon=6.6930, radius_m=400, elev=1800),
            skiroute.Destination("Champagny-en-Vanoise", lat=45.4670, lon=6.7060, radius_m=500, elev=1250),
            skiroute.Destination("Montchavin",           lat=45.5530, lon=6.7100, radius_m=400, elev=1250),
        ],
    ),
    ResortSpec(  # 4 ROSIERE
        name="La Rosière",
        pattern="%La Rosière%",
        destinations=[
            skiroute.Destination("La Rosière 1850", lat=45.6210, lon=6.8510, radius_m=500, elev=1850),
            skiroute.Destination("Les Eucherts",    lat=45.6180, lon=6.8590, radius_m=400, elev=1850),
        ],
    ),
    ResortSpec(  # 5 STE_FOY
        name="Sainte-Foy Tarentaise",
        pattern="%Sainte-Foy Tarentaise%",
        destinations=[
            skiroute.Destination("Sainte-Foy Station", lat=45.5920, lon=6.9190, radius_m=400, elev=1550),
        ],
    ),
    ResortSpec(  # 6 VALMOREL
        name="Valmorel / Le Grand Domaine",
        pattern="%Valmorel%Grand Domaine%",
        destinations=[
            skiroute.Destination("Valmorel",                 lat=45.4620, lon=6.4490, radius_m=500, elev=1400),
            skiroute.Destination("Saint-François-Longchamp", lat=45.4360, lon=6.3890, radius_m=500, elev=1450),
        ],
    ),
    ResortSpec(  # 7 DIAMANT
        name="Espace Diamant",
        pattern="%Espace Diamant%",
        destinations=[
            skiroute.Destination("Les Saisies",              lat=45.7600, lon=6.5360, radius_m=500, elev=1650),
            skiroute.Destination("Notre-Dame-de-Bellecombe", lat=45.7920, lon=6.5510, radius_m=500, elev=1150),
            skiroute.Destination("Crest-Voland",             lat=45.7920, lon=6.4990, radius_m=400, elev=1230),
        ],
    ),
    ResortSpec(  # 8 PRALOGNAN
        name="Pralognan-la-Vanoise",
        pattern="%Pralognan%",
        destinations=[
            skiroute.Destination("Pralognan", lat=45.3800, lon=6.7240, radius_m=500, elev=1450),
        ],
    ),
    ResortSpec(  # 9 VAL_CENIS
        name="Val Cenis (Haute Maurienne)",
        pattern="%Espace Haute Maurienne Vanoise%Val Cenis%",
        destinations=[
            skiroute.Destination("Lanslebourg",   lat=45.2880, lon=6.8800, radius_m=500, elev=1400),
            skiroute.Destination("Lanslevillard", lat=45.2780, lon=6.9060, radius_m=500, elev=1500),
            skiroute.Destination("Termignon",     lat=45.2700, lon=6.8200, radius_m=500, elev=1300),
        ],
    ),
    ResortSpec(  # 10 BONNEVAL
        name="Bonneval-sur-Arc",
        pattern="%Bonneval-sur-Arc%",
        destinations=[
            skiroute.Destination("Bonneval-sur-Arc", lat=45.3680, lon=7.0480, radius_m=500, elev=1800),
        ],
    ),
    ResortSpec(  # 11 GALIBIER
        name="Galibier-Thabor (Valloire-Valmeinier)",
        pattern="%Galibier-Thabor%",
        destinations=[
            skiroute.Destination("Valloire",        lat=45.1660, lon=6.4280, radius_m=600, elev=1430),
            skiroute.Destination("Valmeinier 1800", lat=45.1810, lon=6.4940, radius_m=500, elev=1800),
        ],
    ),
    ResortSpec(  # 12 VALFREJUS
        name="Valfréjus",
        pattern="%Espace Haute Maurienne Vanoise%Valfréjus%",
        destinations=[
            skiroute.Destination("Valfréjus", lat=45.1700, lon=6.6620, radius_m=400, elev=1550),
        ],
    ),
    ResortSpec(  # 13 NORMA
        name="La Norma",
        pattern="%Espace Haute Maurienne Vanoise%La Norma%",
        destinations=[
            skiroute.Destination("La Norma", lat=45.1980, lon=6.7150, radius_m=400, elev=1350),
        ],
    ),
    ResortSpec(  # 14 AUSSOIS
        name="Aussois",
        pattern="%Espace Haute Maurienne Vanoise%Aussois%",
        destinations=[
            skiroute.Destination("Aussois", lat=45.2310, lon=6.7430, radius_m=400, elev=1500),
        ],
    ),
    ResortSpec(  # 15 ARECHES
        name="Arêches-Beaufort",
        pattern="%Arêches Beaufort%",
        destinations=[
            skiroute.Destination("Arêches",  lat=45.6700, lon=6.5840, radius_m=500, elev=1080),
            skiroute.Destination("Beaufort", lat=45.7180, lon=6.5740, radius_m=500, elev=750),
        ],
    ),
]

# Index aliases match RESORTS order (kept for documentation, not used)
(TIGNES, TROIS_VALLEES, ARCS, PLAGNE, ROSIERE, STE_FOY,
 VALMOREL, DIAMANT, PRALOGNAN, VAL_CENIS,
 BONNEVAL, GALIBIER, VALFREJUS, NORMA, AUSSOIS, ARECHES) = range(16)


# NOTE: the previous experimental stitched worlds (Tignes + Trois Vallées,
# Savoie-16 mega) lived here and used the connector + auto-piste-connector
# functions below. They were removed because the synthetic cable cars
# across the Vanoise National Park didn't produce useful routing — most
# queries either ignored the connectors entirely or sent you on an
# unrealistic continent-spanning ride. The code is kept for reference
# in case we want to bring them back with a different connector model.


def make_savoie_connectors() -> list[Connector]:
    """Hand-crafted cable car / traverse connectors between geographically
    adjacent resorts. Endpoint strings are *lift names* that appear in
    each resort's OpenSkiData listing; the stitcher resolves to the
    highest-elevation matching node."""
    return [
        # === Tignes ↔ Trois Vallées (across the Vanoise National Park) ===
        Connector("Aiguille Percée", "Mont Vallon",
                  name="Vanoise Express",
                  from_resort_index=TIGNES, to_resort_index=TROIS_VALLEES),
        Connector("Grande Motte", "Cime Caron",
                  name="Glacier Express",
                  from_resort_index=TIGNES, to_resort_index=TROIS_VALLEES),

        # === Tignes ↔ Les Arcs ===
        Connector("Bellevarde Express", "Aiguille Rouge",
                  name="Tarentaise Express",
                  from_resort_index=TIGNES, to_resort_index=ARCS),

        # === Tignes ↔ La Rosière (Col du Petit-Saint-Bernard) ===
        Connector("Tovière", "Mont Valaisan",
                  name="Petit-Saint-Bernard Express",
                  from_resort_index=TIGNES, to_resort_index=ROSIERE),

        # === Tignes ↔ Sainte-Foy ===
        Connector("Fornet", "Aiguille",
                  name="Sainte-Foy Link",
                  from_resort_index=TIGNES, to_resort_index=STE_FOY),

        # === Tignes ↔ Val Cenis (Col de l'Iseran — real road pass) ===
        Connector("Vallon de l'Iseran", "Mont Cenis",
                  name="Col de l'Iseran Express",
                  from_resort_index=TIGNES, to_resort_index=VAL_CENIS),

        # === Les Arcs ↔ La Plagne (the real Vanoise Express!) ===
        Connector("Vanoise Express", "Vanoise Express",
                  name="Vanoise Express (real)",
                  from_resort_index=ARCS, to_resort_index=PLAGNE),

        # === Les Arcs ↔ La Rosière ===
        Connector("Aiguille Rouge", "Mont Valaisan",
                  name="Col du Petit-Saint-Bernard",
                  from_resort_index=ARCS, to_resort_index=ROSIERE),

        # === Les Arcs ↔ Sainte-Foy ===
        Connector("Villaroger", "Marquise",
                  name="Isère Crossing",
                  from_resort_index=ARCS, to_resort_index=STE_FOY),

        # === La Plagne ↔ Valmorel (Beaufortain) ===
        Connector("Bellecôte", "Cheval Blanc",
                  name="Beaufortain Link",
                  from_resort_index=PLAGNE, to_resort_index=VALMOREL),

        # === La Plagne ↔ Trois Vallées ===
        Connector("Champagny", "Mont Vallon",
                  name="Champagny – Mottaret Express",
                  from_resort_index=PLAGNE, to_resort_index=TROIS_VALLEES),

        # === La Plagne ↔ Espace Diamant ===
        Connector("Roche de Mio", "Légette",
                  name="Roche de Mio Skyway",
                  from_resort_index=PLAGNE, to_resort_index=DIAMANT),

        # === Trois Vallées ↔ Valmorel ===
        Connector("Cherferie", "Madeleine",
                  name="Cherferie – Madeleine",
                  from_resort_index=TROIS_VALLEES, to_resort_index=VALMOREL),

        # === Trois Vallées ↔ Pralognan ===
        Connector("Mont Vallon", "Mont Bochor",
                  name="Col d'Aussois Cable Car",
                  from_resort_index=TROIS_VALLEES, to_resort_index=PRALOGNAN),

        # === Trois Vallées ↔ Val Cenis ===
        Connector("Cime Caron", "Mont Cenis",
                  name="Maurienne Skyway",
                  from_resort_index=TROIS_VALLEES, to_resort_index=VAL_CENIS),

        # === Pralognan ↔ Val Cenis ===
        Connector("Mont Bochor", "Solert",
                  name="Vanoise Crest",
                  from_resort_index=PRALOGNAN, to_resort_index=VAL_CENIS),

        # === Valmorel ↔ Espace Diamant ===
        Connector("Cheval Blanc", "Crêt du Midi",
                  name="Beaufortain Crest",
                  from_resort_index=VALMOREL, to_resort_index=DIAMANT),

        # === Bonneval-sur-Arc ↔ Val Cenis ===
        Connector("3000", "Mont Cenis",
                  name="Haute Maurienne Express",
                  from_resort_index=BONNEVAL, to_resort_index=VAL_CENIS),
        Connector("Vallonnet", "Vallon de l'Iseran",
                  name="Col de l'Iseran (south)",
                  from_resort_index=BONNEVAL, to_resort_index=TIGNES),

        # === Galibier-Thabor ↔ ... ===
        Connector("Crête", "Punta Bagna",
                  name="Col du Galibier Express",
                  from_resort_index=GALIBIER, to_resort_index=VALFREJUS),
        Connector("Lac de la Vieille", "Mont Cenis",
                  name="Maurienne West Skyway",
                  from_resort_index=GALIBIER, to_resort_index=VAL_CENIS),

        # === Valfréjus ↔ ... ===
        Connector("Punta Bagna", "Norma II",
                  name="Frejus – Norma",
                  from_resort_index=VALFREJUS, to_resort_index=NORMA),
        Connector("Plateau", "Mont Cenis",
                  name="Frejus – Val Cenis",
                  from_resort_index=VALFREJUS, to_resort_index=VAL_CENIS),

        # === La Norma ↔ Aussois ===
        Connector("Norma II", "Plan Sec",
                  name="Norma – Aussois",
                  from_resort_index=NORMA, to_resort_index=AUSSOIS),

        # === Aussois ↔ Pralognan ===
        Connector("Plan Sec", "Mont Bochor",
                  name="Col d'Aussois (south)",
                  from_resort_index=AUSSOIS, to_resort_index=PRALOGNAN),

        # === Aussois ↔ Val Cenis ===
        Connector("Plan Sec", "Mont Cenis",
                  name="Aussois – Val Cenis",
                  from_resort_index=AUSSOIS, to_resort_index=VAL_CENIS),

        # === Arêches-Beaufort ↔ ... ===
        Connector("Grand Mont", "Roche de Mio",
                  name="Beaufortain – Plagne",
                  from_resort_index=ARECHES, to_resort_index=PLAGNE),
        Connector("Grand Mont", "Légette",
                  name="Beaufortain – Diamant",
                  from_resort_index=ARECHES, to_resort_index=DIAMANT),
        Connector("Grand Mont", "Cheval Blanc",
                  name="Beaufortain – Valmorel",
                  from_resort_index=ARECHES, to_resort_index=VALMOREL),
    ]


# Adjacency map used to auto-generate piste connectors between resort pairs
SAVOIE_ADJACENCY_PAIRS = [
    (TIGNES, TROIS_VALLEES), (TIGNES, ARCS), (TIGNES, ROSIERE), (TIGNES, STE_FOY),
    (TIGNES, VAL_CENIS), (TIGNES, BONNEVAL),
    (TROIS_VALLEES, PLAGNE), (TROIS_VALLEES, VALMOREL), (TROIS_VALLEES, PRALOGNAN),
    (TROIS_VALLEES, VAL_CENIS),
    (ARCS, PLAGNE), (ARCS, ROSIERE), (ARCS, STE_FOY),
    (PLAGNE, VALMOREL), (PLAGNE, DIAMANT), (PLAGNE, ARECHES),
    (ROSIERE, STE_FOY),
    (VALMOREL, DIAMANT), (VALMOREL, ARECHES),
    (DIAMANT, ARECHES),
    (PRALOGNAN, VAL_CENIS), (PRALOGNAN, AUSSOIS),
    (VAL_CENIS, BONNEVAL), (VAL_CENIS, GALIBIER), (VAL_CENIS, VALFREJUS),
    (VAL_CENIS, NORMA), (VAL_CENIS, AUSSOIS),
    (GALIBIER, VALFREJUS), (VALFREJUS, NORMA), (NORMA, AUSSOIS),
    (AUSSOIS, PRALOGNAN),
]


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _build_resort(idx: int) -> skiroute.Graph:
    spec = RESORTS[idx]
    print(f"    building {spec.name!r}...", flush=True)
    return skiroute.build_graph(
        gpkg_path=GPKG,
        resort=skiroute.ResortFilter(ski_area_pattern=spec.pattern),
        destinations=spec.destinations,
        verbose=False,
    )


# URL-safe slug for each resort. Must be in the same order as RESORTS.
SINGLE_RESORT_SLUGS = [
    "tignes",            # TIGNES         (0)
    "trois-vallees",     # TROIS_VALLEES  (1)
    "les-arcs",          # ARCS           (2)
    "la-plagne",         # PLAGNE         (3)
    "la-rosiere",        # ROSIERE        (4)
    "sainte-foy",        # STE_FOY        (5)
    "valmorel",          # VALMOREL       (6)
    "espace-diamant",    # DIAMANT        (7)
    "pralognan",         # PRALOGNAN      (8)
    "val-cenis",         # VAL_CENIS      (9)
    "bonneval-sur-arc",  # BONNEVAL       (10)
    "galibier-thabor",   # GALIBIER       (11)
    "valfrejus",         # VALFREJUS      (12)
    "la-norma",          # NORMA          (13)
    "aussois",           # AUSSOIS        (14)
    "areches-beaufort",  # ARECHES        (15)
]


def build_tignes_three_valleys() -> skiroute.Graph:
    tignes = _build_resort(TIGNES)
    trois_v = _build_resort(TROIS_VALLEES)
    print("    stitching with 2 cable car connectors...")
    return stitch_graphs(
        [tignes, trois_v],
        connectors=[
            Connector("Aiguille Percée", "Mont Vallon",
                      name="Vanoise Express",
                      from_resort_index=0, to_resort_index=1),
            Connector("Grande Motte", "Cime Caron",
                      name="Glacier Express",
                      from_resort_index=0, to_resort_index=1),
        ],
        verbose=False,
    )


def build_savoie_16() -> skiroute.Graph:
    graphs = []
    for i in range(len(RESORTS)):
        graphs.append(_build_resort(i))
    print(f"    auto-generating piste connectors across "
          f"{len(SAVOIE_ADJACENCY_PAIRS)} adjacent resort pairs...")
    auto = auto_piste_connectors(graphs, SAVOIE_ADJACENCY_PAIRS, per_pair=4)
    print(f"    stitching {len(graphs)} resorts + {len(make_savoie_connectors())} "
          f"hand-crafted + {len(auto)} auto-generated connectors...")
    return stitch_graphs(graphs, make_savoie_connectors() + auto, verbose=False)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


# Single-resort builders only. The previous stitched worlds
# (tignes-three-valleys, savoie-16) were removed — their build functions
# are still defined above for reference but no longer wired in.
WORLDS: dict = {
    slug: (lambda i=i: _build_resort(i))
    for i, slug in enumerate(SINGLE_RESORT_SLUGS)
}


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    if not GPKG.exists():
        print(f"GeoPackage not found at {GPKG}.")
        print("Set SKIROUTE_GPKG=/path/to/openskidata.gpkg or drop it next to this script.")
        print("Download: https://openskidata.org/")
        sys.exit(1)

    only = set(sys.argv[1:])
    for name, builder in WORLDS.items():
        if only and name not in only:
            print(f"-- skipping {name} (not in CLI filter)")
            continue
        print(f"\n=== {name} ===")
        t0 = time.perf_counter()
        g = builder()
        out_path = OUT_DIR / f"{name}.json"
        g.save(out_path)
        size_mb = out_path.stat().st_size / 1_048_576
        print(f"    → {out_path}  ({g}, {size_mb:.2f} MB, "
              f"built in {time.perf_counter() - t0:.1f}s)")


if __name__ == "__main__":
    main()
