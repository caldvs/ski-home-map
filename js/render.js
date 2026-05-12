/**
 * MapLibre map setup, terrain, hillshade, contour lines, and the graph layers
 * (pistes, lifts, stations, villages). All layer specs live here.
 */

import { LIFT_COLOUR } from "./graph.js";

export function initMap(container, initialView) {
  const map = new maplibregl.Map({
    container,
    style: "https://tiles.openfreemap.org/styles/liberty",
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
  return map;
}

export function addBaseLayers(map) {
  // Terrain DEM
  map.addSource("terrain-dem", {
    type: "raster-dem",
    url: "https://tiles.mapterhorn.com/tilejson.json",
  });
  map.setTerrain({ source: "terrain-dem", exaggeration: 1.2 });

  // Hillshade
  map.addLayer({
    id: "hillshade-layer",
    type: "hillshade",
    source: "terrain-dem",
    paint: {
      "hillshade-shadow-color": "#4a3e30",
      "hillshade-highlight-color": "#ffffff",
      "hillshade-accent-color": "#a08770",
      "hillshade-illumination-direction": 335,
      "hillshade-exaggeration": 0.65,
    },
  }, "park");

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
  map.addLayer({
    id: "contour-lines",
    type: "line",
    source: "contour-source",
    "source-layer": "contours",
    paint: {
      "line-color": [
        "case",
        ["==", ["get", "level"], 1],
        "rgba(80, 60, 40, 0.75)",
        "rgba(80, 60, 40, 0.45)",
      ],
      "line-width": [
        "interpolate", ["linear"], ["zoom"],
        10, ["case", ["==", ["get", "level"], 1], 0.7, 0.3],
        14, ["case", ["==", ["get", "level"], 1], 1.3, 0.6],
        18, ["case", ["==", ["get", "level"], 1], 2.0, 1.0],
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
      "text-color": "rgba(60, 45, 30, 0.92)",
      "text-halo-color": "rgba(255, 255, 255, 0.85)",
      "text-halo-width": 1.4,
    },
  });
}

export function addGraphLayers(map, graph) {
  // Pistes outline + colour
  map.addSource("pistes", { type: "geojson", data: graph.pistesFC });
  map.addLayer({
    id: "pistes-outline",
    source: "pistes",
    type: "line",
    paint: {
      "line-color": "#fff",
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.8, 14, 4, 18, 7],
      "line-opacity": 0.7,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "pistes-layer",
    source: "pistes",
    type: "line",
    paint: {
      "line-color": ["get", "colour"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.0, 14, 2.5, 18, 5],
      "line-opacity": 0.95,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });

  // Lifts down (dashed, hidden by default)
  map.addSource("lifts-down", { type: "geojson", data: graph.liftsDownFC });
  map.addLayer({
    id: "lifts-down-layer",
    source: "lifts-down",
    type: "line",
    paint: {
      "line-color": LIFT_COLOUR,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.7, 14, 1.4, 18, 2.2],
      "line-opacity": 0.55,
      "line-dasharray": [3, 3],
    },
    layout: { visibility: "none" },
  });

  // Lifts up
  map.addSource("lifts", { type: "geojson", data: graph.liftsFC });
  map.addLayer({
    id: "lifts-layer",
    source: "lifts",
    type: "line",
    paint: {
      "line-color": LIFT_COLOUR,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.4, 14, 3.0, 18, 5.5],
      "line-opacity": 0.95,
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

  // Piste name labels
  map.addLayer({
    id: "piste-labels",
    type: "symbol",
    source: "pistes",
    minzoom: 12,
    filter: ["!=", ["get", "display_name"], ""],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 350,
      "text-field": ["get", "display_name"],
      "text-font": ["Noto Sans Bold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9, 15, 11, 18, 13],
      "text-padding": 4,
      "text-letter-spacing": 0.05,
    },
    paint: {
      "text-color": ["get", "colour"],
      "text-halo-color": "#fff",
      "text-halo-width": 1.8,
    },
  });

  // Lift name labels (with type)
  map.addLayer({
    id: "lift-labels",
    type: "symbol",
    source: "lifts",
    minzoom: 12,
    filter: ["!=", ["get", "display_name"], ""],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 400,
      "text-field": ["get", "display_name"],
      "text-font": ["Noto Sans Bold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9, 15, 11, 18, 13],
      "text-padding": 4,
      "text-letter-spacing": 0.05,
    },
    paint: {
      "text-color": LIFT_COLOUR,
      "text-halo-color": "#fff",
      "text-halo-width": 1.8,
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
      "circle-color": "#e74c3c",
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

  // Empty user-route source (filled when user drops two pins)
  map.addSource("user-route", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "user-route-layer",
    source: "user-route",
    type: "line",
    paint: {
      "line-color": "#ffe000",
      "line-width": 5,
      "line-opacity": 0.95,
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
  bind("lyr-lifts",     ["lifts-layer", "lift-labels"]);
  bind("lyr-stations",  ["stations-layer"]);
  bind("lyr-villages",  ["villages-layer", "villages-label"]);
  bind("lyr-skates",    ["skates-layer"]);
  bind("lyr-hillshade", ["hillshade-layer"]);
  bind("lyr-contours",  ["contour-lines", "contour-labels"]);

  const terrainCb = document.getElementById("lyr-terrain");
  if (terrainCb) {
    terrainCb.addEventListener("change", (e) => {
      map.setTerrain(
        e.target.checked
          ? { source: "terrain-dem", exaggeration: 1.2 }
          : null,
      );
    });
  }
}
