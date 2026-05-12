# ski-home-map

Interactive 3D web map for ski routing across French Alpine resorts.

A dashboard for picking which "world" to explore, then a MapLibre GL map
where you drop two pins, get a route, watch the algorithm explore, and
see sun shadows for any time of day. Built on
[skiroute](https://github.com/caldvs/skiroute), powered by
[OpenSkiData](https://openskidata.org/).

**Live**: [caldvs.github.io/ski-home-map](https://caldvs.github.io/ski-home-map/)

## Worlds available

Sixteen contiguous Savoie ski areas, each a standalone routable graph
in `data/`.

| Region | Resorts |
|---|---|
| Tarentaise | Tignes / Val d'Isère · Trois Vallées · Les Arcs · La Plagne · La Rosière · Sainte-Foy Tarentaise |
| Vanoise west | Valmorel · Pralognan-la-Vanoise |
| Beaufortain | Espace Diamant · Arêches-Beaufort |
| Maurienne | Val Cenis · Bonneval-sur-Arc · Aussois · La Norma · Valfréjus · Galibier-Thabor (Valloire/Valmeinier) |

Earlier versions of this site included two stitched mega-worlds — Tignes
plus Trois Vallées (via two synthetic cable cars over the Vanoise) and
a 16-resort Savoie mega-network. They were removed because the synthetic
connectors didn't produce realistic routes: queries either ignored the
cable cars entirely or sent skiers on absurd continent-spanning rides.
The stitching code is preserved in `skiroute.stitch` for future
experiments with a better connector cost model.

## How it works

- **Static site.** Plain HTML + CSS + ES modules. No build step.
- **Graph data.** Built ahead of time by `skiroute` from the
  [OpenSkiData](https://openskidata.org/) GeoPackage and committed to
  `data/`. See `scripts/build_data.py`.
- **Routing in the browser.** JS Dijkstra / A* / Bidirectional Dijkstra
  run on the loaded graph. ~200 ms per query on the largest world.
- **3D terrain.** [Mapterhorn](https://mapterhorn.com/) DEM tiles via
  MapLibre. Contour lines generated on the fly by
  [maplibre-contour](https://github.com/onthegomap/maplibre-contour).
- **Sun shadows.** [ShadeMap](https://shademap.app/) plugin — free
  educational tier covers localhost / file://. The first visit prompts
  for your API key, which is stored in `localStorage` only.

## Use it locally

Just open `index.html`. No build, no dev server.

```bash
git clone https://github.com/caldvs/ski-home-map
cd ski-home-map
open index.html
```

(Or serve via any static server: `python3 -m http.server` then visit
[http://localhost:8000](http://localhost:8000).)

## Rebuild the data

When the OpenSkiData GeoPackage updates and you want fresh graphs:

```bash
pip install skiroute
SKIROUTE_GPKG=/path/to/openskidata.gpkg python3 scripts/build_data.py
git commit data/ -m "Update graphs"
```

## Layout

```
ski-home-map/
├── index.html              dashboard ("pick a world")
├── map.html                map view (?world=tignes)
├── css/
│   ├── style.css           dashboard styles
│   └── map.css             map view styles
├── js/
│   ├── dashboard.js        world tile rendering
│   ├── worlds.js           world preset definitions
│   ├── app.js              map page entry point
│   ├── graph.js            load + reshape skiroute JSON
│   ├── render.js           MapLibre setup + layers
│   ├── routing.js          Dijkstra / A* / Bidirectional
│   ├── sun.js              ShadeMap integration + time controls
│   └── ui.js               panels, pins, algorithm animation, perf
├── data/
│   └── tignes.json         pre-built routing graph
└── scripts/
    └── build_data.py       regenerate data/ from OpenSkiData GPKG
```

## Data sources

| Layer | Source | License |
|---|---|---|
| Base vector tiles | [OpenFreeMap](https://openfreemap.org/) | OpenStreetMap data via [OpenMapTiles](https://openmaptiles.org/) schema |
| Map data | [OpenStreetMap](https://www.openstreetmap.org/copyright) | ODbL |
| Terrain DEM | [Mapterhorn](https://mapterhorn.com/attribution/) | Per their attribution |
| Pistes & lifts | [OpenSkiData](https://openskidata.org/) | ODbL |
| Sun shadow rendering | [ShadeMap](https://shademap.app/) | Free educational tier |
| Routing library | [skiroute](https://github.com/caldvs/skiroute) | MIT |

## License

MIT. See [LICENSE](https://github.com/caldvs/ski-home-map/blob/main/LICENSE).
