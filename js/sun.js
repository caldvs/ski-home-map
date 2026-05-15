/**
 * Sun + time-of-day integration.
 *
 * Visual shadows come from ShadeMap (mapbox-gl-shadow-simulator). The
 * ShadowLayer is still instantiated, but only as a DEM-sampling helper
 * for elevation.js — it is not added to the map.
 */

import { sunPosition } from "./sun-position.js";
import { ShadowLayer } from "./shadow-layer.js";
import { TimeScrubber } from "./time-scrubber.js";

// Try local override first; fall back to committed placeholder so deploy
// keeps working when the workflow injects a key.
let SHADEMAP_API_KEY = "";
try {
  const mod = await import("./config.local.js");
  SHADEMAP_API_KEY = (mod.SHADEMAP_API_KEY || "").trim();
} catch (e) { /* config.local.js absent — fine in CI */ }
if (!SHADEMAP_API_KEY) {
  try {
    const mod = await import("./config.js");
    SHADEMAP_API_KEY = (mod.SHADEMAP_API_KEY || "").trim();
  } catch (e) { /* no config.js — ShadeMap will be inert */ }
}

export function wireSun(map) {
  let currentDate = new Date();

  const bbox = map._resortBbox || { minLon: 6.9, maxLon: 7.0, minLat: 45.4, maxLat: 45.5 };
  const centerLon = (bbox.minLon + bbox.maxLon) / 2;
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;

  // DEM-only ShadowLayer: needed so elevation.js can sample piste profiles.
  // Never added to the map as a render layer.
  const demSampler = new ShadowLayer({ opacity: 0 });

  let shadeMap = null;
  let shadowsCurrentlyAdded = false;

  // Shadow visibility is now mode-driven: forced on in sun mode, forced off
  // in route mode. setMode in map.html calls window._setShadowsEnabled().
  let shadowsWanted = (typeof document !== "undefined" && document.body.classList.contains("mode-sun"));

  // Keep our overlay layers (routes, pistes, lifts, …) above the shadow.
  // Note: piste-labels and lift-labels are deliberately placed AFTER the
  // route layers so the yellow route line doesn't cover the piste / lift
  // names when a route is drawn.
  const TOP_LAYERS = [
    "shadow-mask-layer",
    "contour-lines", "contour-labels",
    "pistes-outline", "pistes-layer",
    "lifts-casing", "lifts-layer", "lifts-down-layer",
    "skates-layer",
    "stations-layer", "villages-layer", "villages-label",
    "user-route-piste-base", "user-route-piste-dash", "user-route-lift",
    "user-route-arrows", "user-route-transitions-layer",
    "start-approach-layer",
    "route-leg-highlight-halo", "route-leg-highlight-layer",
    "anim-settled-layer",
    "piste-labels", "lift-labels",
  ];
  function promoteOverlaysAboveShade() {
    for (const id of TOP_LAYERS) {
      if (map.getLayer(id)) { try { map.moveLayer(id); } catch (e) {} }
    }
  }

  function applyShadowVisibility() {
    if (!shadeMap) return;
    const want = shadowsWanted;
    if (want && !shadowsCurrentlyAdded) {
      shadeMap.addTo(map);
      shadowsCurrentlyAdded = true;
      promoteOverlaysAboveShade();
      if (map.getLayer("hillshade")) {
        map.setLayoutProperty("hillshade", "visibility", "none");
      }
    } else if (!want && shadowsCurrentlyAdded) {
      shadeMap.remove();
      shadowsCurrentlyAdded = false;
      if (map.getLayer("hillshade")) {
        map.setLayoutProperty("hillshade", "visibility", "visible");
      }
    }
  }

  function initShadeMap() {
    if (typeof ShadeMap === "undefined") {
      console.warn("[shadows] ShadeMap script not loaded — shadows disabled.");
      return;
    }
    if (!SHADEMAP_API_KEY) {
      console.warn("[shadows] no SHADEMAP_API_KEY — shadows disabled.");
      return;
    }
    shadeMap = new ShadeMap({
      apiKey: SHADEMAP_API_KEY,
      date: currentDate,
      color: "#01112f",
      opacity: 0.55,
      // Sun mode is locked to pitch=0 (top-down) so map.getBounds() exactly
      // matches the visible viewport — no need for an oversized custom getSize
      // to handle pitch-extended trapezoids. Omitting getSize lets ShadeMap
      // use its default bounds, which means its 300×150 internal canvas
      // covers only the visible area and shadow edges stay as sharp as the
      // 300×150 grid allows.
      // (Pinned to 2:1 aspect ratio matching ShadeMap's canvas, sized to the
      // viewport so the bounds rectangle isn't bigger than what we display.)
      getSize: () => {
        const cv = map.getCanvas();
        const w = cv.clientWidth, h = cv.clientHeight;
        // Match the wider of the two viewport dimensions × 2:1 aspect.
        const side = Math.max(w, h);
        return { width: side * 2, height: side };
      },
      // Mapterhorn DEM — same origin MapLibre's 3D terrain source already
      // fetches from, so tiles for the visible viewport are already in the
      // browser's HTTP cache and ShadeMap's requests resolve instantly. AWS
      // terrarium has too much latency from Europe and pushes 100+ KB PNGs.
      // _overzoom: 13 caps ShadeMap's internal render zoom at the same level
      // tiles are actually served at — without it, the default (_overzoom 20)
      // makes the heightmap upsample to z15+ and leaves gaps where requested
      // tiles 404 against the real mapterhorn maxzoom.
      terrainSource: {
        tileSize: 512,
        maxZoom: 13,
        _overzoom: 13,
        getSourceUrl: ({ x, y, z }) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,
        getElevation: ({ r, g, b }) => r * 256 + g + b / 256 - 32768,
      },
    });
    window._shadeMap = shadeMap;
    applyShadowVisibility();

    // In 3D mode, DEM tiles for the new viewport can finish loading after
    // ShadeMap has already rendered, leaving "bare" tiles with no shadow.
    // Pattern: when the map moves, arm an idle-listener; on the next idle
    // (= rendering + tile loads are quiet), force ShadeMap to recompute by
    // calling setDate. The arm-flag prevents the self-triggered idle from
    // looping (idle would re-fire after our setDate causes more activity).
    let pendingIdleKick = false;
    map.on("movestart", () => { if (shadowsCurrentlyAdded) pendingIdleKick = true; });
    map.on("idle", () => {
      if (!pendingIdleKick || !shadowsCurrentlyAdded || !shadeMap) return;
      pendingIdleKick = false;
      shadeMap.setDate(new Date(currentDate.getTime()));
    });
  }

  // Preload DEM data for elevation.js. Runs in parallel with ShadeMap init.
  async function initDemSampler() {
    try {
      await demSampler.setBbox(bbox, { bufferKm: 12 });
      window._shadowDem = demSampler;
      if (typeof window._refreshElevation === "function") {
        try { window._refreshElevation(); } catch (e) {}
      }
    } catch (e) {
      console.error("[shadows] DEM sampler load failed:", e);
    }
  }

  // Exposed for the mode switcher in map.html.
  window._setShadowsEnabled = (on) => {
    shadowsWanted = !!on;
    applyShadowVisibility();
  };

  // Time scrubber
  const scrubberContainer = document.getElementById("time-scrubber");
  let scrubber = null;
  if (scrubberContainer) {
    scrubber = new TimeScrubber({
      container: scrubberContainer,
      onChange: (date) => {
        currentDate = new Date(date.getTime());
        if (shadeMap) shadeMap.setDate(currentDate);
        if (!shadowsWanted) {
          shadowsWanted = true;
          if (shadowsCheckbox) shadowsCheckbox.checked = true;
          applyShadowVisibility();
        }
      },
      sunPositionFn: (date) => sunPosition(date, centerLat, centerLon),
    });
    scrubber.setDate(currentDate, { silent: true });
    window._renderTimeScrubber = () => {
      if (scrubber) scrubber.setDate(currentDate, { silent: true });
    };
    new ResizeObserver(() => scrubber.render()).observe(scrubberContainer);
  }

  initDemSampler();
  initShadeMap();
}
