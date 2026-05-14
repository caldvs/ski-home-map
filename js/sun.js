/**
 * Sun + time-of-day integration.
 *
 * Drives the custom WebGL shadow renderer (ShadowLayer) from a master
 * clock the TimeScrubber edits. There's no sidebar UI to mirror state
 * into — the scrubber owns time.
 */

import { sunPosition } from "./sun-position.js";
import { ShadowLayer } from "./shadow-layer.js";
import { TimeScrubber } from "./time-scrubber.js";

export function wireSun(map) {
  // Master clock — every shadow update reads from here.
  let currentDate = new Date();

  // Resort centroid (sun-position math).
  const bbox = map._resortBbox || { minLon: 6.9, maxLon: 7.0, minLat: 45.4, maxLat: 45.5 };
  const centerLon = (bbox.minLon + bbox.maxLon) / 2;
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;

  const customShadow = new ShadowLayer({ opacity: 0.55 });
  let shadowsCurrentlyAdded = false;

  // Shadows layer-toggle (in Layers mode bottom pane).
  const shadowsCheckbox = document.getElementById("lyr-shadows");
  let shadowsWanted = shadowsCheckbox ? shadowsCheckbox.checked : true;

  function updateCustomShadowSun() {
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
    const want = shadowsWanted;
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
  }

  async function initCustomShadows() {
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

  if (shadowsCheckbox) {
    shadowsCheckbox.addEventListener("change", (e) => {
      shadowsWanted = e.target.checked;
      applyShadowVisibility();
    });
  }

  // Time scrubber
  const scrubberContainer = document.getElementById("time-scrubber");
  let scrubber = null;
  if (scrubberContainer) {
    scrubber = new TimeScrubber({
      container: scrubberContainer,
      onChange: (date) => {
        currentDate = new Date(date.getTime());
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

  initCustomShadows();
}
