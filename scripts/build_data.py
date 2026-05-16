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

# Stitching is only needed by the legacy mega-world builders below, which
# aren't wired into `WORLDS`. If the installed skiroute lacks the stitch
# module, fall back to stub symbols so the file still imports.
try:
    from skiroute.stitch import Connector, auto_piste_connectors, stitch_graphs
except ModuleNotFoundError:
    def _stitch_unavailable(*_args, **_kwargs):
        raise RuntimeError(
            "skiroute.stitch is not available in this skiroute install — "
            "the mega-world builders can't run, but single-resort builds work."
        )
    Connector = _stitch_unavailable
    auto_piste_connectors = _stitch_unavailable
    stitch_graphs = _stitch_unavailable


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
            # Arc 1800 base = Villards / Charmettoger lift hub (Transarc I,
            # Vagère, Charmettoger bottoms cluster here). The previous coord
            # (45.6010, 6.7800) was 3 km north — it snapped onto the
            # Millerette beginner lift and left Arc 1800 stranded with no
            # route to Peisey-Vallandry.
            skiroute.Destination("Arc 1800",         lat=45.5720, lon=6.7790, radius_m=500, elev=1800),
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

    # ─────────────────────────────────────────────────────────────────────
    # TIER 1 — nationwide rollout. Patterns are best-guess against
    # OpenSkiData ski_area_names. If a build returns 0 nodes for a resort,
    # check the gpkg with: SELECT DISTINCT name FROM ski_areas WHERE name LIKE …
    # and tighten the pattern; village destinations can stay as-is.
    # ─────────────────────────────────────────────────────────────────────

    ResortSpec(  # 16 PORTES_DU_SOLEIL (French side)
        name="Portes du Soleil",
        pattern="%Portes du Soleil%",
        destinations=[
            skiroute.Destination("Avoriaz",   lat=46.1880, lon=6.7740, radius_m=600, elev=1800),
            skiroute.Destination("Morzine",   lat=46.1800, lon=6.7080, radius_m=600, elev=1000),
            skiroute.Destination("Les Gets",  lat=46.1590, lon=6.6680, radius_m=600, elev=1170),
            skiroute.Destination("Châtel",    lat=46.2630, lon=6.8400, radius_m=500, elev=1180),
            skiroute.Destination("Abondance", lat=46.2790, lon=6.7240, radius_m=500, elev=930),
        ],
    ),
    ResortSpec(  # 17 GRAND_MASSIF
        name="Grand Massif",
        pattern="%Grand Massif%",
        destinations=[
            skiroute.Destination("Flaine",       lat=46.0030, lon=6.6960, radius_m=600, elev=1600),
            skiroute.Destination("Les Carroz",   lat=46.0440, lon=6.6810, radius_m=500, elev=1140),
            skiroute.Destination("Morillon",     lat=46.0790, lon=6.6810, radius_m=500, elev=700),
            skiroute.Destination("Samoëns",      lat=46.0820, lon=6.7270, radius_m=500, elev=720),
            skiroute.Destination("Sixt-Fer-à-Cheval", lat=46.0530, lon=6.7770, radius_m=500, elev=780),
        ],
    ),
    ResortSpec(  # 18 EVASION_MONT_BLANC
        name="Évasion Mont-Blanc",
        pattern="%Évasion Mont-Blanc%",
        destinations=[
            skiroute.Destination("Megève",          lat=45.8580, lon=6.6170, radius_m=600, elev=1110),
            skiroute.Destination("Saint-Gervais",   lat=45.8910, lon=6.7140, radius_m=500, elev=850),
            skiroute.Destination("Les Contamines",  lat=45.8230, lon=6.7270, radius_m=500, elev=1170),
            skiroute.Destination("Combloux",        lat=45.8990, lon=6.6450, radius_m=500, elev=1000),
            skiroute.Destination("La Giettaz",      lat=45.8660, lon=6.5320, radius_m=500, elev=1140),
        ],
    ),
    ResortSpec(  # 19 CHAMONIX_VALLEY
        name="Chamonix-Mont-Blanc",
        pattern="%Chamonix%",
        destinations=[
            skiroute.Destination("Chamonix",      lat=45.9237, lon=6.8694, radius_m=600, elev=1035),
            skiroute.Destination("Argentière",    lat=45.9710, lon=6.9290, radius_m=500, elev=1252),
            skiroute.Destination("Le Tour",       lat=45.9870, lon=6.9740, radius_m=500, elev=1462),
            skiroute.Destination("Les Houches",   lat=45.8910, lon=6.7960, radius_m=500, elev=1010),
        ],
    ),
    ResortSpec(  # 20 ARAVIS
        name="Aravis (La Clusaz + Grand-Bornand)",
        pattern="%Aravis%",
        destinations=[
            skiroute.Destination("La Clusaz",       lat=45.9050, lon=6.4250, radius_m=600, elev=1100),
            skiroute.Destination("Le Grand-Bornand", lat=45.9420, lon=6.4290, radius_m=500, elev=1000),
            skiroute.Destination("Manigod",         lat=45.8470, lon=6.4060, radius_m=500, elev=950),
        ],
    ),

    ResortSpec(  # 21 ALPE_D_HUEZ
        name="Alpe d'Huez Grand Domaine",
        pattern="%Alpe d'Huez%",
        destinations=[
            skiroute.Destination("Alpe d'Huez",   lat=45.0908, lon=6.0680, radius_m=600, elev=1860),
            skiroute.Destination("Auris-en-Oisans", lat=45.0670, lon=6.1060, radius_m=500, elev=1600),
            skiroute.Destination("Oz-en-Oisans",  lat=45.1090, lon=6.0260, radius_m=500, elev=1350),
            skiroute.Destination("Vaujany",       lat=45.1530, lon=6.0530, radius_m=500, elev=1250),
            skiroute.Destination("Villard-Reculas", lat=45.0980, lon=6.0290, radius_m=500, elev=1500),
        ],
    ),
    ResortSpec(  # 22 LES_DEUX_ALPES
        name="Les Deux Alpes",
        pattern="%Deux Alpes%",
        destinations=[
            skiroute.Destination("Les Deux Alpes", lat=45.0130, lon=6.1240, radius_m=600, elev=1650),
        ],
    ),
    ResortSpec(  # 23 SEPT_LAUX
        name="Les 7 Laux",
        pattern="%7 Laux%",
        destinations=[
            skiroute.Destination("Prapoutel",  lat=45.2460, lon=5.9740, radius_m=500, elev=1350),
            skiroute.Destination("Pipay",      lat=45.2660, lon=5.9930, radius_m=500, elev=1550),
            skiroute.Destination("Le Pleynet", lat=45.2890, lon=6.0140, radius_m=500, elev=1450),
        ],
    ),
    ResortSpec(  # 24 CHAMROUSSE
        name="Chamrousse",
        pattern="%Chamrousse%",
        destinations=[
            skiroute.Destination("Chamrousse 1650", lat=45.1160, lon=5.8710, radius_m=500, elev=1650),
            skiroute.Destination("Chamrousse 1750", lat=45.1240, lon=5.8830, radius_m=500, elev=1750),
        ],
    ),
    ResortSpec(  # 25 VILLARD_DE_LANS
        name="Villard-de-Lans / Corrençon",
        pattern="%Villard%Lans%",
        destinations=[
            skiroute.Destination("Villard-de-Lans", lat=45.0710, lon=5.5460, radius_m=600, elev=1050),
            skiroute.Destination("Corrençon",       lat=45.0290, lon=5.5320, radius_m=500, elev=1110),
        ],
    ),

    ResortSpec(  # 26 SERRE_CHEVALIER
        name="Serre Chevalier",
        pattern="%Serre Chevalier%",
        destinations=[
            skiroute.Destination("Briançon",         lat=44.8980, lon=6.6360, radius_m=600, elev=1326),
            skiroute.Destination("Chantemerle",      lat=44.9290, lon=6.5710, radius_m=500, elev=1350),
            skiroute.Destination("Villeneuve",       lat=44.9430, lon=6.5520, radius_m=600, elev=1400),
            skiroute.Destination("Le Monêtier-les-Bains", lat=44.9760, lon=6.5070, radius_m=500, elev=1500),
        ],
    ),
    ResortSpec(  # 27 VARS_RISOUL
        name="Forêt Blanche (Vars + Risoul)",
        pattern="%Forêt Blanche%",
        destinations=[
            skiroute.Destination("Vars Les Claux",  lat=44.5800, lon=6.6940, radius_m=500, elev=1850),
            skiroute.Destination("Vars Sainte-Marie", lat=44.5660, lon=6.6790, radius_m=500, elev=1660),
            skiroute.Destination("Risoul 1850",     lat=44.6240, lon=6.6470, radius_m=600, elev=1850),
        ],
    ),
    ResortSpec(  # 28 MONTGENEVRE
        name="Montgenèvre",
        pattern="%Montgenèvre%",
        destinations=[
            skiroute.Destination("Montgenèvre", lat=44.9320, lon=6.7260, radius_m=600, elev=1860),
        ],
    ),
    ResortSpec(  # 29 ORCIERES_MERLETTE
        name="Orcières-Merlette",
        pattern="%Orcières%",
        destinations=[
            skiroute.Destination("Orcières-Merlette 1850", lat=44.7010, lon=6.3290, radius_m=500, elev=1850),
        ],
    ),
    ResortSpec(  # 30 LES_ORRES
        name="Les Orres",
        pattern="%Les Orres%",
        destinations=[
            skiroute.Destination("Les Orres 1650", lat=44.5010, lon=6.5630, radius_m=500, elev=1650),
            skiroute.Destination("Les Orres 1800", lat=44.5070, lon=6.5660, radius_m=500, elev=1800),
        ],
    ),
    ResortSpec(  # 31 PUY_SAINT_VINCENT
        name="Puy-Saint-Vincent",
        pattern="%Puy%Saint%Vincent%",
        destinations=[
            skiroute.Destination("Puy-Saint-Vincent 1600", lat=44.8420, lon=6.5050, radius_m=500, elev=1600),
            skiroute.Destination("Puy-Saint-Vincent 1800", lat=44.8400, lon=6.5020, radius_m=500, elev=1800),
        ],
    ),
    ResortSpec(  # 32 LE_DEVOLUY
        name="Le Dévoluy",
        pattern="%Dévoluy%",
        destinations=[
            skiroute.Destination("Superdévoluy",  lat=44.6740, lon=5.9090, radius_m=500, elev=1500),
            skiroute.Destination("La Joue-du-Loup", lat=44.6550, lon=5.9290, radius_m=500, elev=1450),
        ],
    ),

    ResortSpec(  # 33 PRA_LOUP
        name="Pra Loup",
        pattern="%Pra Loup%",
        destinations=[
            skiroute.Destination("Pra Loup 1500", lat=44.3680, lon=6.5910, radius_m=500, elev=1500),
            skiroute.Destination("Pra Loup 1600", lat=44.3640, lon=6.5870, radius_m=500, elev=1600),
        ],
    ),
    ResortSpec(  # 34 VAL_D_ALLOS
        name="Val d'Allos",
        pattern="%Val d'Allos%",
        destinations=[
            skiroute.Destination("La Foux d'Allos", lat=44.2730, lon=6.5870, radius_m=500, elev=1800),
            skiroute.Destination("Le Seignus",       lat=44.2510, lon=6.6080, radius_m=500, elev=1500),
        ],
    ),
    ResortSpec(  # 35 AURON
        name="Auron",
        pattern="%Auron%",
        destinations=[
            skiroute.Destination("Auron", lat=44.1160, lon=6.9480, radius_m=500, elev=1600),
        ],
    ),
    ResortSpec(  # 36 ISOLA_2000
        name="Isola 2000",
        pattern="%Isola%",
        destinations=[
            skiroute.Destination("Isola 2000", lat=44.1810, lon=7.1550, radius_m=500, elev=2000),
        ],
    ),
    ResortSpec(  # 37 VALBERG_BEUIL
        name="Valberg / Beuil",
        pattern="%Valberg%",
        destinations=[
            skiroute.Destination("Valberg", lat=44.0900, lon=6.9430, radius_m=500, elev=1700),
            skiroute.Destination("Beuil",   lat=44.0930, lon=6.9920, radius_m=500, elev=1450),
        ],
    ),

    # ─────────────────────────────────────────────────────────────────────
    # TIER 2 — Pyrénées (east to west). OpenSkiData coverage in the
    # Pyrenees is decent but not as complete as the Alps; expect a few of
    # these to land as small graphs that need an overrides pass.
    # ─────────────────────────────────────────────────────────────────────

    ResortSpec(  # 38 GRAND_TOURMALET
        name="Grand Tourmalet",
        pattern="%Grand Tourmalet%",
        destinations=[
            skiroute.Destination("La Mongie", lat=42.9100, lon=0.1860, radius_m=600, elev=1800),
            skiroute.Destination("Barèges",   lat=42.8970, lon=0.0670, radius_m=500, elev=1250),
        ],
    ),
    ResortSpec(  # 39 SAINT_LARY
        name="Saint-Lary-Soulan",
        pattern="%Saint-Lary%",
        destinations=[
            skiroute.Destination("Saint-Lary 1700", lat=42.8060, lon=0.3230, radius_m=500, elev=1700),
            skiroute.Destination("Saint-Lary 1900", lat=42.8190, lon=0.3380, radius_m=500, elev=1900),
            skiroute.Destination("Saint-Lary village", lat=42.8160, lon=0.3210, radius_m=500, elev=830),
        ],
    ),
    ResortSpec(  # 40 PEYRAGUDES
        name="Peyragudes",
        pattern="%Peyragudes%",
        destinations=[
            skiroute.Destination("Peyresourde", lat=42.7980, lon=0.4380, radius_m=500, elev=1605),
            skiroute.Destination("Les Agudes",  lat=42.7970, lon=0.4630, radius_m=500, elev=1600),
        ],
    ),
    ResortSpec(  # 41 CAUTERETS
        name="Cauterets",
        pattern="%Cauterets%",
        destinations=[
            skiroute.Destination("Cauterets - Cirque du Lys", lat=42.8510, lon=-0.1030, radius_m=500, elev=1850),
            skiroute.Destination("Cauterets village",         lat=42.8870, lon=-0.1130, radius_m=500, elev=930),
        ],
    ),
    ResortSpec(  # 42 LUZ_ARDIDEN
        name="Luz-Ardiden",
        pattern="%Luz%Ardiden%",
        destinations=[
            skiroute.Destination("Luz-Ardiden",       lat=42.8720, lon=-0.0270, radius_m=500, elev=1720),
            skiroute.Destination("Luz-Saint-Sauveur", lat=42.8730, lon=-0.0050, radius_m=500, elev=720),
        ],
    ),
    ResortSpec(  # 43 PIAU_ENGALY
        name="Piau-Engaly",
        pattern="%Piau%Engaly%",
        destinations=[
            skiroute.Destination("Piau-Engaly", lat=42.7890, lon=0.1580, radius_m=500, elev=1850),
        ],
    ),
    ResortSpec(  # 44 GAVARNIE
        name="Gavarnie-Gèdre",
        pattern="%Gavarnie%",
        destinations=[
            skiroute.Destination("Gavarnie-Gèdre", lat=42.7360, lon=-0.0220, radius_m=500, elev=1850),
        ],
    ),
    ResortSpec(  # 45 LUCHON_SUPERBAGNERES
        name="Luchon-Superbagnères",
        pattern="%Superbagnères%",
        destinations=[
            skiroute.Destination("Superbagnères",         lat=42.7700, lon=0.5850, radius_m=500, elev=1800),
            skiroute.Destination("Bagnères-de-Luchon",    lat=42.7900, lon=0.5930, radius_m=500, elev=630),
        ],
    ),
    ResortSpec(  # 46 HAUTACAM
        name="Hautacam",
        pattern="%Hautacam%",
        destinations=[
            skiroute.Destination("Hautacam", lat=42.9850, lon=-0.0520, radius_m=500, elev=1500),
        ],
    ),
    ResortSpec(  # 47 AX_3_DOMAINES
        name="Ax 3 Domaines",
        pattern="%Ax%Domaines%",
        destinations=[
            skiroute.Destination("Bonascre",       lat=42.7150, lon=1.8260, radius_m=500, elev=1400),
            skiroute.Destination("Ax-les-Thermes", lat=42.7220, lon=1.8390, radius_m=500, elev=720),
        ],
    ),
    ResortSpec(  # 48 GUZET
        name="Guzet",
        pattern="%Guzet%",
        destinations=[
            skiroute.Destination("Guzet", lat=42.7810, lon=1.2900, radius_m=500, elev=1480),
        ],
    ),
    ResortSpec(  # 49 GOURETTE
        name="Gourette",
        pattern="%Gourette%",
        destinations=[
            skiroute.Destination("Gourette", lat=42.9530, lon=-0.3370, radius_m=500, elev=1400),
        ],
    ),
    ResortSpec(  # 50 ARTOUSTE
        name="Artouste",
        pattern="%Artouste%",
        destinations=[
            skiroute.Destination("Artouste-Fabrèges", lat=42.8860, lon=-0.4300, radius_m=500, elev=1250),
        ],
    ),
    ResortSpec(  # 51 LA_PIERRE_SAINT_MARTIN
        name="La Pierre Saint-Martin",
        pattern="%Pierre Saint%Martin%",
        destinations=[
            skiroute.Destination("La Pierre Saint-Martin", lat=42.9890, lon=-0.7760, radius_m=500, elev=1620),
        ],
    ),
    ResortSpec(  # 52 FONT_ROMEU
        name="Font-Romeu / Pyrénées 2000",
        pattern="%Font%Romeu%",
        destinations=[
            skiroute.Destination("Font-Romeu",     lat=42.5100, lon=2.0400, radius_m=500, elev=1800),
            skiroute.Destination("Pyrénées 2000",  lat=42.5180, lon=2.0530, radius_m=500, elev=2000),
        ],
    ),
    ResortSpec(  # 53 LES_ANGLES
        name="Les Angles",
        pattern="%Les Angles%",
        destinations=[
            skiroute.Destination("Les Angles", lat=42.5660, lon=2.0920, radius_m=500, elev=1650),
        ],
    ),
    ResortSpec(  # 54 FORMIGUERES
        name="Formiguères",
        pattern="%Formiguères%",
        destinations=[
            skiroute.Destination("Formiguères", lat=42.6200, lon=2.1070, radius_m=500, elev=1500),
        ],
    ),
    ResortSpec(  # 55 PORTE_PUYMORENS
        name="Porté-Puymorens",
        pattern="%Porté%Puymorens%",
        destinations=[
            skiroute.Destination("Porté-Puymorens", lat=42.5470, lon=1.8040, radius_m=500, elev=1600),
        ],
    ),
    ResortSpec(  # 56 CAMBRE_D_AZE
        name="Cambre d'Aze",
        pattern="%Cambre%Aze%",
        destinations=[
            skiroute.Destination("Eyne",                     lat=42.4760, lon=2.0870, radius_m=500, elev=1600),
            skiroute.Destination("Saint-Pierre-dels-Forcats", lat=42.4900, lon=2.0790, radius_m=500, elev=1600),
        ],
    ),
    ResortSpec(  # 57 PUYVALADOR
        name="Puyvalador",
        pattern="%Puyvalador%",
        destinations=[
            skiroute.Destination("Puyvalador", lat=42.6920, lon=2.0300, radius_m=500, elev=1700),
        ],
    ),

    # ─────────────────────────────────────────────────────────────────────
    # TIER 3 — Jura, Vosges, Massif Central. Small ranges, sometimes
    # patchy OpenSkiData coverage — destinations are conservative.
    # ─────────────────────────────────────────────────────────────────────

    ResortSpec(  # 58 METABIEF
        name="Métabief",
        pattern="%Métabief%",
        destinations=[
            skiroute.Destination("Métabief",  lat=46.7700, lon=6.3450, radius_m=500, elev=1000),
            skiroute.Destination("Mont d'Or", lat=46.7600, lon=6.3050, radius_m=500, elev=1430),
        ],
    ),
    ResortSpec(  # 59 LES_ROUSSES
        name="Les Rousses",
        pattern="%Rousses%",
        destinations=[
            skiroute.Destination("Les Rousses",  lat=46.5040, lon=6.0640, radius_m=500, elev=1120),
            skiroute.Destination("Lamoura",      lat=46.4570, lon=5.9710, radius_m=500, elev=1150),
            skiroute.Destination("Bois d'Amont", lat=46.5300, lon=6.0860, radius_m=500, elev=1060),
            skiroute.Destination("Prémanon",     lat=46.4860, lon=6.0440, radius_m=500, elev=1110),
        ],
    ),
    ResortSpec(  # 60 MONTS_JURA
        name="Monts Jura",
        pattern="%Monts Jura%",
        destinations=[
            skiroute.Destination("Lélex",  lat=46.2920, lon=5.8330, radius_m=500, elev=900),
            skiroute.Destination("Crozet", lat=46.2620, lon=6.0150, radius_m=500, elev=850),
            skiroute.Destination("Mijoux", lat=46.3640, lon=5.9520, radius_m=500, elev=1010),
        ],
    ),

    ResortSpec(  # 61 GERARDMER
        name="Gérardmer",
        pattern="%Gérardmer%",
        destinations=[
            skiroute.Destination("Gérardmer", lat=48.0750, lon=6.8530, radius_m=500, elev=750),
        ],
    ),
    ResortSpec(  # 62 LA_BRESSE
        name="La Bresse-Hohneck",
        pattern="%Bresse%Hohneck%",
        destinations=[
            skiroute.Destination("La Bresse", lat=48.0000, lon=6.8800, radius_m=500, elev=630),
        ],
    ),
    ResortSpec(  # 63 LE_MARKSTEIN
        name="Le Markstein-Grand Ballon",
        pattern="%Markstein%",
        destinations=[
            skiroute.Destination("Le Markstein",  lat=47.9130, lon=7.0450, radius_m=500, elev=1240),
            skiroute.Destination("Grand Ballon",  lat=47.9020, lon=7.1040, radius_m=500, elev=1400),
        ],
    ),
    ResortSpec(  # 64 VENTRON
        name="Ventron",
        pattern="%Ventron%",
        destinations=[
            skiroute.Destination("Ventron", lat=47.9460, lon=6.8810, radius_m=500, elev=900),
        ],
    ),

    ResortSpec(  # 65 LE_MONT_DORE
        name="Le Mont-Dore",
        pattern="%Mont%Dore%",
        destinations=[
            skiroute.Destination("Le Mont-Dore", lat=45.5800, lon=2.8080, radius_m=500, elev=1050),
        ],
    ),
    ResortSpec(  # 66 SUPER_BESSE
        name="Super-Besse",
        pattern="%Super%Besse%",
        destinations=[
            skiroute.Destination("Super-Besse", lat=45.5100, lon=2.8570, radius_m=500, elev=1350),
        ],
    ),
    ResortSpec(  # 67 LE_LIORAN
        name="Le Lioran",
        pattern="%Lioran%",
        destinations=[
            skiroute.Destination("Le Lioran", lat=45.0820, lon=2.7470, radius_m=500, elev=1240),
        ],
    ),
    ResortSpec(  # 68 CHASTREIX_SANCY
        name="Chastreix-Sancy",
        pattern="%Chastreix%",
        destinations=[
            skiroute.Destination("Chastreix-Sancy", lat=45.5410, lon=2.7640, radius_m=500, elev=1300),
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
    # Tier 1 — nationwide rollout
    "portes-du-soleil",    # (16)
    "grand-massif",        # (17)
    "evasion-mont-blanc",  # (18)
    "chamonix-valley",     # (19)
    "aravis",              # (20)
    "alpe-d-huez",         # (21)
    "les-deux-alpes",      # (22)
    "sept-laux",           # (23)
    "chamrousse",          # (24)
    "villard-de-lans",     # (25)
    "serre-chevalier",     # (26)
    "vars-risoul",         # (27)
    "montgenevre",         # (28)
    "orcieres-merlette",   # (29)
    "les-orres",           # (30)
    "puy-saint-vincent",   # (31)
    "le-devoluy",          # (32)
    "pra-loup",            # (33)
    "val-d-allos",         # (34)
    "auron",               # (35)
    "isola-2000",          # (36)
    "valberg-beuil",       # (37)
    # Tier 2 — Pyrénées
    "grand-tourmalet",        # (38)
    "saint-lary-soulan",      # (39)
    "peyragudes",             # (40)
    "cauterets",              # (41)
    "luz-ardiden",            # (42)
    "piau-engaly",            # (43)
    "gavarnie",               # (44)
    "luchon-superbagneres",   # (45)
    "hautacam",               # (46)
    "ax-3-domaines",          # (47)
    "guzet",                  # (48)
    "gourette",               # (49)
    "artouste",               # (50)
    "la-pierre-saint-martin", # (51)
    "font-romeu",             # (52)
    "les-angles",             # (53)
    "formigueres",            # (54)
    "porte-puymorens",        # (55)
    "cambre-d-aze",           # (56)
    "puyvalador",             # (57)
    # Tier 3 — Jura / Vosges / Massif Central
    "metabief",            # (58)
    "les-rousses",         # (59)
    "monts-jura",          # (60)
    "gerardmer",           # (61)
    "la-bresse-hohneck",   # (62)
    "le-markstein",        # (63)
    "ventron",             # (64)
    "le-mont-dore",        # (65)
    "super-besse",         # (66)
    "le-lioran",           # (67)
    "chastreix-sancy",     # (68)
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
