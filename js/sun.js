/**
 * Shadow + time-of-day integration.
 *
 * The custom WebGL shadow renderer (ShadowLayer) is the default.
 * ?shadows=shademap forces the legacy ShadeMap path. Time of day is
 * driven entirely by the TimeScrubber in Sun mode — there's no
 * sidebar UI to mirror state into anymore.
 */

import { SHADEMAP_API_KEY } from "./config.js";
import { sunPosition } from "./sun-position.js";
import { ShadowLayer } from "./shadow-layer.js";
import { TimeScrubber } from "./time-scrubber.js";

const SHADOW_ENGINE = (() => {
  const p = new URLSearchParams(window.location.search);
  const v = (p.get("shadows") || localStorage.getItem("ski:shadows") || "custom").toLowerCase();
  return v === "shademap" ? "shademap" : "custom";
})();

let shadeMap = null;
export function getShadeMap() { return shadeMap; }

function getApiKey() {
  if (SHADEMAP_API_KEY && SHADEMAP_API_KEY.trim()) return SHADEMAP_API_KEY.trim();
  const params = new URLSearchParams(window.location.search);
  if (params.has("shademap_key")) {
    const k = (params.get("shademap_key") || "").trim();
    if (k) {
      localStorage.setItem("shademap_api_key", k);
      params.delete("shademap_key");
      const url = window.location.pathname
        + (params.toString() ? "?" + params.toString() : "")
        + window.location.hash;
      window.history.replaceState({}, "", url);
      return k;
    }
  }
  return (localStorage.getItem("shademap_api_key") || "").trim();
}

export function wireSun(map) {
  // Master clock — every shadow update reads from here.
  let currentDate = new Date();

  // Resort centroid (sun-position math).
  const bbox = map._resortBbox || { minLon: 6.9, maxLon: 7.0, minLat: 45.4, maxLat: 45.5 };
  const centerLon = (bbox.minLon + bbox.maxLon) / 2;
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;

  // Shadow renderer instance.
  let customShadow = null;
  if (SHADOW_ENGINE === "custom") {
    customShadow = new ShadowLayer({ opacity: 0.55 });
  }
  let shadowsCurrentlyAdded = false;

  // Shadows layer-toggle (in Layers mode bottom pane).
  const shadowsCheckbox = document.getElementById("lyr-shadows");
  let shadowsWanted = shadowsCheckbox ? shadowsCheckbox.checked : true;

  function shouldShowShadows() {
    if (SHADOW_ENGINE === "custom") return shadowsWanted && customShadow;
    return shadowsWanted && shadeMap;
  }

  function updateCustomShadowSun() {
    if (!customShadow) return;
    const pos = sunPosition(currentDate, centerLat, centerLon);
    customShadow.setSun(pos.azimuth, pos.altitude);
  }

  // Layers we want on top of the shadow.
  const TOP_LAYERS = [
    "shadow-mask-layer",
    "contour-lines", "contour-labels",
    "pistes-outline", "pistes-layer", "piste-labels",
    "lifts-casing", "lifts-layer", "lifts-down-layer", "lift-labels",
    "skates-layer",
    "stations-layer", "villages-layer", "villages-label",
    "user-route-layer", "start-approach-layer",
    "route-leg-highlight-halo", "route-leg-highlight-layer",
    "anim-settled-layer",
  ];
  function promoteOverlaysAboveShade() {
    for (const id of TOP_LAYERS) {
      if (map.getLayer(id)) { try { map.moveLayer(id); } catch (e) {} }
    }
  }

  function applyShadowVisibility() {
    // ---- Custom WebGL path ----
    if (SHADOW_ENGINE === "custom") {
      if (!customShadow) return;
      const want = shouldShowShadows();
      if (want && !shadowsCurrentlyAdded) {
        if (!map.getLayer(customShadow.id)) map.addLayer(customShadow);
        shadowsCurrentlyAdded = true;
        promoteOverlaysAboveShade();
        if (map.getLayer("hillshade")) {
          map.setLayoutProperty("hillshade", "visibility", "none");
        }
        updateCustomShadowSun();
      } else if (!want && shadowsCurrentlyAdded) {
        if (map.getLayer(customShadow.id)) map.removeLayer(customShadow.id);
        shadowsCurrentlyAdded = false;
        if (map.getLayer("hillshade")) {
          map.setLayoutProperty("hillshade", "visibility", "visible");
        }
      }
      return;
    }

    // ---- ShadeMap fallback path ----
    if (!shadeMap) return;
    const want = shouldShowShadows();
    if (want && !shadowsCurrentlyAdded) {
      shadeMap.addTo(map);
      shadowsCurrentlyAdded = true;
      if (map.getLayer("shadow-mask-layer")) {
        map.setLayoutProperty("shadow-mask-layer", "visibility", "visible");
      }
      promoteOverlaysAboveShade();
      if (map.getLayer("hillshade")) {
        map.setLayoutProperty("hillshade", "visibility", "none");
      }
    } else if (!want && shadowsCurrentlyAdded) {
      shadeMap.remove();
      shadowsCurrentlyAdded = false;
      if (map.getLayer("shadow-mask-layer")) {
        map.setLayoutProperty("shadow-mask-layer", "visibility", "none");
      }
      if (map.getLayer("hillshade")) {
        map.setLayoutProperty("hillshade", "visibility", "visible");
      }
    }
  }

  async function initCustomShadows() {
    if (!customShadow) return;
    if (!map.getLayer(customShadow.id)) map.addLayer(customShadow);
    promoteOverlaysAboveShade();
    try {
      await customShadow.setBbox(bbox, { bufferKm: 12 });
      console.log(`[shadow] DEM ready: ${customShadow.dem.tilesLoaded} tiles, `
        + `maxElev ${Math.round(customShadow.dem.maxElev)}m`);
      // Expose to elevation.js for per-pixel piste profile sampling.
      window._shadowDem = customShadow;
      // If a route was already plotted before the DEM finished loading,
      // re-render the elevation profile so it picks up real samples.
      if (typeof window._refreshElevation === "function") {
        try { window._refreshElevation(); } catch (e) {}
      }
    } catch (e) {
      console.error("[shadow] DEM load failed:", e);
    }
    updateCustomShadowSun();
    applyShadowVisibility();
  }

  function initShadeMap() {
    const apiKey = getApiKey();
    if (!apiKey || typeof ShadeMap === "undefined") return;
    shadeMap = new ShadeMap({
      date: currentDate,
      color: "#01112f",
      opacity: 0.55,
      apiKey,
      terrainSource: {
        tileSize: 512,
        maxZoom: 9,
        getSourceUrl: ({ x, y, z }) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,
        getElevation: ({ r, g, b }) => r * 256 + g + b / 256 - 32768,
      },
    });
    applyShadowVisibility();
  }

  // Layer-toggle wiring for the master shadow checkbox.
  if (shadowsCheckbox) {
    shadowsCheckbox.addEventListener("change", (e) => {
      shadowsWanted = e.target.checked;
      applyShadowVisibility();
    });
  }

  // ── Time scrubber ──
  const scrubberContainer = document.getElementById("time-scrubber");
  let scrubber = null;
  if (scrubberContainer) {
    scrubber = new TimeScrubber({
      container: scrubberContainer,
      onChange: (date) => {
        currentDate = new Date(date.getTime());
        if (shadeMap) shadeMap.setDate(currentDate);
        updateCustomShadowSun();
        // Implicitly turn shadows on when the user touches the time.
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

  // Boot the right shadow engine.
  if (SHADOW_ENGINE === "custom") initCustomShadows();
  else initShadeMap();
}
