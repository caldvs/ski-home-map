/**
 * MapLibre map setup, terrain, hillshade, contour lines, and the graph layers
 * (pistes, lifts, stations, villages). All layer specs live here.
 */

import { LIFT_COLOUR } from "./graph.js";

export function initMap(container, initialView) {
  const map = new maplibregl.Map({
    container,
    // Vendored openskimap terrain_v2 style: their basemap layers verbatim
    // with the ski-specific sources stripped (we render those from our
    // own graph) and glyph/sprite urls repointed to OpenFreeMap. The
    // vector tiles themselves are OpenFreeMap, which is what openskimap
    // already uses upstream.
    style: "./styles/terrain.json",
    center: initialView.center,
    zoom: initialView.zoom,
    pitch: initialView.pitch,
    bearing: initialView.bearing,
    maxPitch: 75,
    hash: true,
    attributionControl: { compact: true },
    pixelRatio: window.devicePixelRatio || 1,
    maxTileCacheSize: 512,
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl(), "bottom-right");

  // The vendored openskimap style references POI sprite icons that aren't
  // in the OpenFreeMap sprite sheet (cycling, sports_centre, swimming_pool,
  // recycling, lift_gate, gate, office, climbing_adventure, reservoir,
  // guidepost, …). Without a handler MapLibre fires a warnOnce for each
  // missing id every tile, flooding the console. Supply a 1×1 transparent
  // placeholder so those layers silently render nothing.
  map.on("styleimagemissing", (e) => {
    if (map.hasImage(e.id)) return;
    map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });

  return map;
}

// Try to insert a layer before `beforeId`; fall back to adding it on top
// if that reference layer doesn't exist in the current style.
function addLayerBefore(map, layer, beforeId) {
  if (beforeId && map.getLayer(beforeId)) {
    map.addLayer(layer, beforeId);
  } else {
    map.addLayer(layer);
  }
}

export function addBaseLayers(map) {
  // The terrain.json style already defines:
  //   - 3D terrain (terrain block → "terrain" raster-dem source)
  //   - Hillshade layer id "hillshade" using the "hillshade" raster-dem source
  // Both point at Mapterhorn (same supplier we used before). So we no
  // longer add our own DEM source / hillshade-layer here — only the
  // contour-lines layer, which openskimap doesn't render via vector tiles.

  // Contour lines via maplibre-contour (browser-side from the same DEM)
  const demSource = new mlcontour.DemSource({
    url: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
    encoding: "terrarium",
    maxzoom: 13,
    worker: true,
  });
  demSource.setupMaplibre(maplibregl);

  map.addSource("contour-source", {
    type: "vector",
    tiles: [
      demSource.contourProtocolUrl({
        multiplier: 1,
        thresholds: {
          9:  [500, 2000],
          10: [200, 1000],
          11: [100, 500],
          12: [50, 250],
          13: [25, 100],
          14: [20, 100],
        },
        contourLayer: "contours",
        elevationKey: "ele",
        levelKey: "level",
        extent: 4096,
        buffer: 1,
      }),
    ],
    maxzoom: 15,
  });
  addLayerBefore(map, {
    id: "contour-lines",
    type: "line",
    source: "contour-source",
    "source-layer": "contours",
    paint: {
      // Softer contours: the vendored openskimap basemap already shows
      // terrain via hillshade, so the contour lines exist to *hint* at
      // elevation rather than dominate. Major (level=1) lines stay
      // visible; minor lines almost fade into the basemap.
      "line-color": [
        "case",
        ["==", ["get", "level"], 1],
        "rgba(80, 60, 40, 0.45)",
        "rgba(100, 80, 55, 0.22)",
      ],
      "line-width": [
        "interpolate", ["linear"], ["zoom"],
        10, ["case", ["==", ["get", "level"], 1], 0.5, 0.2],
        14, ["case", ["==", ["get", "level"], 1], 1.0, 0.4],
        18, ["case", ["==", ["get", "level"], 1], 1.4, 0.6],
      ],
    },
  }, "road_minor");
  map.addLayer({
    id: "contour-labels",
    type: "symbol",
    source: "contour-source",
    "source-layer": "contours",
    minzoom: 12,
    filter: [">", ["get", "level"], 0],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 220,
      "text-field": ["concat", ["get", "ele"], "m"],
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "interpolate", ["linear"], ["zoom"],
        12, 9, 15, 11, 18, 13,
      ],
      "text-padding": 6,
      "text-rotation-alignment": "map",
    },
    paint: {
      "text-color": "rgba(75, 55, 35, 0.7)",
      "text-halo-color": "rgba(255, 255, 255, 0.75)",
      "text-halo-width": 1.1,
    },
  });
}

export function addGraphLayers(map, graph) {
  // Compute resort bbox once. Used by the shadow-mask layer below and
  // exposed on the map instance so sun.js can pre-warm DEM tiles in
  // a buffer around it.
  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  for (const n of graph.raw.nodes) {
    if (n.lon < minLon) minLon = n.lon;
    if (n.lon > maxLon) maxLon = n.lon;
    if (n.lat < minLat) minLat = n.lat;
    if (n.lat > maxLat) maxLat = n.lat;
  }
  // Pad by ~1 km — enough to keep on-piste landmarks inside without
  // bleeding the mask into distant terrain. 0.01 deg ≈ 1.1 km at lat 45.
  const PAD_DEG = 0.012;
  // GeoJSON polygon-with-hole: outer ring CCW, inner ring CW (right-hand rule).
  const outer = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  const inner = [
    [minLon - PAD_DEG, minLat - PAD_DEG],   // SW
    [minLon - PAD_DEG, maxLat + PAD_DEG],   // NW
    [maxLon + PAD_DEG, maxLat + PAD_DEG],   // NE
    [maxLon + PAD_DEG, minLat - PAD_DEG],   // SE
    [minLon - PAD_DEG, minLat - PAD_DEG],   // SW (close)
  ];
  map._resortBbox = { minLon, maxLon, minLat, maxLat };

  // Shadow mask: a "donut" polygon covering everywhere EXCEPT the
  // resort domain, painted in the basemap paper colour. Sits above
  // the shadow layer so the harsh outer cutoff of our stitched DEM
  // (the edge of the loaded tiles + buffer) is hidden behind a clean
  // horizon. Layout-hidden until shadows are turned on.
  map.addSource("shadow-mask", {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [outer, inner] },
      properties: {},
    },
  });
  map.addLayer({
    id: "shadow-mask-layer",
    source: "shadow-mask",
    type: "fill",
    paint: {
      "fill-color": "#ecdfc5",   // matches --paper basemap background
      "fill-opacity": 1,
    },
    layout: { visibility: "none" },
  });

  // Pistes — matched to openskimap.org's downhill-runs paint (without
  // their per-feature `downhill` offset, which we don't carry in our
  // graph format). Exponential interpolation, exp-base 1.1.
  map.addSource("pistes", { type: "geojson", data: graph.pistesFC });
  map.addLayer({
    id: "pistes-outline",
    source: "pistes",
    type: "line",
    paint: {
      "line-color": "#fff",
      "line-width": ["interpolate", ["exponential", 1.1], ["zoom"], 7, 0.5, 22, 15],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 18, 1],
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "pistes-layer",
    source: "pistes",
    type: "line",
    paint: {
      "line-color": ["get", "colour"],
      "line-width": ["interpolate", ["exponential", 1.1], ["zoom"], 7, 0.25, 22, 5],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 18, 1],
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });

  // Lifts down (dashed, hidden by default) — same exp-base as lifts.
  map.addSource("lifts-down", { type: "geojson", data: graph.liftsDownFC });
  map.addLayer({
    id: "lifts-down-layer",
    source: "lifts-down",
    type: "line",
    paint: {
      "line-color": LIFT_COLOUR,
      "line-width": ["interpolate", ["exponential", 1.15], ["zoom"], 7, 0.1, 22, 10],
      "line-opacity": 0.55,
      "line-dasharray": [3, 3],
    },
    layout: { visibility: "none" },
  });

  // Lifts — matched to openskimap.org's lift-casing + operating-lift paint.
  // Two stacked lines (white casing under, coloured top) with the same
  // exponential growth (base 1.15) they use.
  map.addSource("lifts", { type: "geojson", data: graph.liftsFC });
  map.addLayer({
    id: "lifts-casing",
    source: "lifts",
    type: "line",
    paint: {
      "line-color": "#fff",
      "line-width": ["interpolate", ["exponential", 1.15], ["zoom"], 7, 0.5, 22, 30],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 18, 1],
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "lifts-layer",
    source: "lifts",
    type: "line",
    paint: {
      "line-color": LIFT_COLOUR,
      "line-width": ["interpolate", ["exponential", 1.15], ["zoom"], 7, 0.2, 22, 15],
      "line-opacity": 0.8,
    },
    layout: { "line-cap": "round" },
  });

  // Skate links (hidden by default)
  map.addSource("skates", { type: "geojson", data: graph.skatesFC });
  map.addLayer({
    id: "skates-layer",
    source: "skates",
    type: "line",
    paint: {
      "line-color": "#999",
      "line-opacity": 0.5,
      "line-dasharray": [2, 3],
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 1.2, 17, 1.8],
    },
    layout: { visibility: "none" },
  });

  // Piste labels — matched to openskimap.org's run-names: data-driven
  // colour, white halo with a hint of blur, label appears from z13.
  map.addLayer({
    id: "piste-labels",
    type: "symbol",
    source: "pistes",
    minzoom: 13,
    filter: ["!=", ["get", "display_name"], ""],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 350,
      "text-field": ["get", "display_name"],
      "text-font": ["Noto Sans Bold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 11, 8, 18, 15],
      "text-offset": [0, 0.15],
      "text-padding": 4,
      "text-max-angle": 30,
      "text-letter-spacing": 0.02,
      "text-rotation-alignment": "map",
      "text-pitch-alignment": "viewport",
      "text-keep-upright": true,
    },
    paint: {
      "text-color": ["get", "colour"],
      "text-halo-color": "#fff",
      "text-halo-width": 1.7,
      "text-halo-blur": 0.5,
    },
  });

  // Lift labels — rendered as POINT symbols at each lift's midpoint
  // (pre-computed in graph.js). Both rotation and pitch alignment use
  // the viewport so the label always reads horizontally on screen,
  // unaffected by 3D terrain bumps or the lift cable's slope.
  map.addSource("lift-labels-source", { type: "geojson", data: graph.liftLabelsFC });
  map.addLayer({
    id: "lift-labels",
    source: "lift-labels-source",
    type: "symbol",
    minzoom: 13,
    layout: {
      "text-field": ["get", "display_name"],
      "text-font": ["Noto Sans Bold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9, 18, 14],
      "text-transform": "uppercase",
      "text-letter-spacing": 0.06,
      "text-padding": 6,
      "text-rotation-alignment": "viewport",
      "text-pitch-alignment": "viewport",
      "text-anchor": "center",
      "text-justify": "center",
    },
    paint: {
      "text-color": "#222",
      "text-halo-color": "#fff",
      "text-halo-width": 2,
      "text-halo-blur": 0.3,
    },
  });

  // Stations
  map.addSource("stations", { type: "geojson", data: graph.stationsFC });
  map.addLayer({
    id: "stations-layer",
    source: "stations",
    type: "circle",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 14, 4, 18, 7],
      "circle-color": "#fff",
      "circle-stroke-color": LIFT_COLOUR,
      "circle-stroke-width": 1.6,
    },
  });

  // Villages
  map.addSource("villages", { type: "geojson", data: graph.villagesFC });
  map.addLayer({
    id: "villages-layer",
    source: "villages",
    type: "circle",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 8, 18, 12],
      "circle-color": "#2466ff",
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 2.5,
    },
  });
  map.addLayer({
    id: "villages-label",
    source: "villages",
    type: "symbol",
    minzoom: 11,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-offset": [0, 1.0],
      "text-anchor": "top",
      "text-padding": 2,
    },
    paint: {
      "text-color": "#222",
      "text-halo-color": "#fff",
      "text-halo-width": 2,
    },
  });

  // Empty user-route source (filled when user drops two pins). Per-leg
  // LineString features tagged with kind:"piste" | "lift" so we can style
  // piste segments differently from lift segments — piste gets a thinner
  // yellow base + white dashes (chevron feel), lift stays solid yellow.
  map.addSource("user-route", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  // Piste base — colour-coded by piste difficulty (drawn from feature props).
  // The white-dash overlay above gives an alternating piste-colour / white
  // striping ("blue/white", "red/white", etc).
  map.addLayer({
    id: "user-route-piste-base",
    source: "user-route",
    type: "line",
    filter: ["==", ["get", "kind"], "piste"],
    paint: {
      "line-color": ["coalesce", ["get", "colour"], "#1e88e5"],
      "line-width": 4,
      "line-opacity": 0.95,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  // White dashed overlay — creates the alternating colour/white pattern.
  map.addLayer({
    id: "user-route-piste-dash",
    source: "user-route",
    type: "line",
    filter: ["==", ["get", "kind"], "piste"],
    paint: {
      "line-color": "#ffffff",
      "line-width": 1.8,
      "line-dasharray": [1.4, 1.4],
      "line-opacity": 0.9,
    },
    layout: { "line-cap": "butt", "line-join": "round" },
  });
  // Lift segments — solid purple to distinguish from piste segments.
  map.addLayer({
    id: "user-route-lift",
    source: "user-route",
    type: "line",
    filter: ["==", ["get", "kind"], "lift"],
    paint: {
      "line-color": "#8b5cf6",
      "line-width": 5,
      "line-opacity": 0.95,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  // Transition dots — placed at every piste↔lift boundary (lift termini).
  // Coloured purple to read as "lift station".
  map.addSource("user-route-transitions", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "user-route-transitions-layer",
    source: "user-route-transitions",
    type: "circle",
    paint: {
      "circle-radius": 5,
      "circle-color": "#8b5cf6",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });

  // Direction-of-travel arrows along the route. Rendered as symbols placed
  // along each leg's LineString; the SDK rotates them to follow the line
  // tangent so they always point in the direction of motion (A → B).
  if (!map.hasImage("route-arrow")) {
    // 22×22 black-edged dark chevron — subtle but legible over the
    // coloured route line. Drawn pointing up (north) so symbol-placement:line
    // rotates it along the line's local heading.
    const SIZE = 22;
    const cv = document.createElement("canvas");
    cv.width = SIZE; cv.height = SIZE;
    const cx = cv.getContext("2d");
    cx.translate(SIZE / 2, SIZE / 2);
    cx.lineWidth = 3;
    cx.lineCap = "round";
    cx.lineJoin = "round";
    cx.strokeStyle = "rgba(20,20,30,0.85)";
    cx.beginPath();
    cx.moveTo(-5, 3);
    cx.lineTo(0, -4);
    cx.lineTo(5, 3);
    cx.stroke();
    const data = cx.getImageData(0, 0, SIZE, SIZE);
    map.addImage("route-arrow", { width: SIZE, height: SIZE, data: new Uint8Array(data.data.buffer) });
  }
  map.addLayer({
    id: "user-route-arrows",
    source: "user-route",
    type: "symbol",
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 80,
      "icon-image": "route-arrow",
      "icon-size": 0.85,
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      // Arrow opacity tapers in as you zoom — invisible at low zoom where the
      // route is a thin line, visible from mid-zooms onward.
    },
    paint: {
      "icon-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0, 13, 0.75, 17, 0.95],
    },
  });

  // Pin-A approach line — dashed grey connector from a free-form pin A
  // (placed off-piste) to the graph node the route actually starts from.
  // Empty unless pin A's display position differs from its routing node.
  map.addSource("start-approach", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "start-approach-layer",
    source: "start-approach",
    type: "line",
    paint: {
      "line-color": "#2466ff",
      "line-width": 3.5,
      "line-dasharray": [2, 1.8],
      "line-opacity": 0.95,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });

  // Highlighted itinerary-leg source — populated on hover of a leg row
  // in the itinerary list. Rendered ON TOP of user-route-layer so the
  // brighter halo + thicker line stands out against the rest of the route.
  map.addSource("route-leg-highlight", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  // Sky-blue highlight contrasts cleanly with the yellow route line,
  // so a hovered / selected leg pops instead of blending in.
  map.addLayer({
    id: "route-leg-highlight-halo",
    source: "route-leg-highlight",
    type: "line",
    paint: {
      "line-color": "#38bdf8",
      "line-width": 16,
      "line-opacity": 0.45,
      "line-blur": 2.5,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "route-leg-highlight-layer",
    source: "route-leg-highlight",
    type: "line",
    paint: {
      "line-color": "#0284c7",
      "line-width": 5,
      "line-opacity": 1,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });

  // Animation overlay
  map.addSource("anim-settled", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "anim-settled-layer",
    source: "anim-settled",
    type: "circle",
    paint: {
      "circle-radius": ["case", ["==", ["get", "meeting"], true], 7, 2.5],
      "circle-color": ["case", ["==", ["get", "dir"], "bwd"], "#ff3399", "#00ccff"],
      "circle-opacity": 0.75,
      "circle-stroke-color": ["case", ["==", ["get", "meeting"], true], "#fff", "rgba(0,0,0,0)"],
      "circle-stroke-width": ["case", ["==", ["get", "meeting"], true], 2.5, 0],
    },
  });

  // Labels above the route — piste / lift names should remain legible even
  // when the yellow user-route line covers their geometry. moveLayer with no
  // beforeId moves them to the very top of the layer stack.
  for (const id of ["piste-labels", "lift-labels"]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

export function wireLayerToggles(map) {
  const bind = (checkboxId, layerIds) => {
    const el = document.getElementById(checkboxId);
    if (!el) return;
    el.addEventListener("change", () => {
      layerIds.forEach((id) => {
        if (!map.getLayer(id)) return;
        map.setLayoutProperty(id, "visibility", el.checked ? "visible" : "none");
      });
    });
  };

  bind("lyr-pistes",    ["pistes-layer", "pistes-outline", "piste-labels"]);
  bind("lyr-lifts",     ["lifts-casing", "lifts-layer", "lift-labels"]);
  bind("lyr-stations",  ["stations-layer"]);
  bind("lyr-villages",  ["villages-layer", "villages-label"]);
  bind("lyr-skates",    ["skates-layer"]);
  // Hillshade layer in the vendored terrain.json is id "hillshade".
  bind("lyr-hillshade", ["hillshade"]);
  bind("lyr-contours",  ["contour-lines", "contour-labels"]);

  const terrainCb = document.getElementById("lyr-terrain");
  if (terrainCb) {
    terrainCb.addEventListener("change", (e) => {
      // The vendored style declares the terrain source as "terrain".
      map.setTerrain(
        e.target.checked ? { source: "terrain", exaggeration: 1.0 } : null,
      );
    });
  }
}
