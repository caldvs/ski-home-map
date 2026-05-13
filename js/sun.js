/**
 * ShadeMap (sun-shadow plugin) integration + time-of-day controls.
 *
 * Shadows render at any pitch — 2D and 3D both work. Render cost is
 * kept manageable by the resort-bbox mask in render.js (only the
 * pixels inside the resort polygon get visible shadow), the lower
 * ShadeMap maxZoom (wider per-tile coverage so distant peaks
 * contribute to low-sun rays), and the DEM pre-warm in prewarmDemTiles.
 *
 * API key is injected at deploy time via js/config.js. Locally,
 * sibling js/config.local.js can override (gitignored).
 */

import { SHADEMAP_API_KEY } from "./config.js";
import { sunPosition } from "./sun-position.js";
import { ShadowLayer } from "./shadow-layer.js";
import { TimeScrubber } from "./time-scrubber.js";

// Default: today's date + the current wall-clock minute. Scrubber lets
// the user drag forwards / backwards from there indefinitely.
function todayISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// Toggle the experimental custom WebGL shadow renderer instead of
// ShadeMap. Flip with ?shadows=custom (or ?shadows=shademap to force
// the old one). Defaults to "custom" while we A/B.
const SHADOW_ENGINE = (() => {
  const p = new URLSearchParams(window.location.search);
  const v = (p.get("shadows") || localStorage.getItem("ski:shadows") || "custom").toLowerCase();
  return v === "shademap" ? "shademap" : "custom";
})();

let shadeMap = null;

export function getShadeMap() { return shadeMap; }

function getApiKey() {
  // 1. Baked-in build config wins — that's how deploys ship.
  if (SHADEMAP_API_KEY && SHADEMAP_API_KEY.trim()) return SHADEMAP_API_KEY.trim();
  // 2. ?shademap_key= URL param (legacy, also caches to localStorage).
  const params = new URLSearchParams(window.location.search);
  if (params.has("shademap_key")) {
    const k = params.get("shademap_key").trim();
    if (k) {
      localStorage.setItem("shademap_api_key", k);
      params.delete("shademap_key");
      const url =
        window.location.pathname +
        (params.toString() ? "?" + params.toString() : "") +
        window.location.hash;
      window.history.replaceState({}, "", url);
      return k;
    }
  }
  // 3. localStorage (legacy).
  return (localStorage.getItem("shademap_api_key") || "").trim();
}

export function wireSun(map) {
  const dateEl = document.getElementById("sun-date");
  const timeLabel = document.getElementById("sun-time-label");
  const sunStatus = document.getElementById("sun-status");
  const shadowsCheckbox = document.getElementById("lyr-shadows");
  const playBtn = document.getElementById("sun-play");
  const gearBtn = document.getElementById("sun-key-gear");

  dateEl.value = todayISODate();
  let sunMinutes = nowMinutes();
  let shadowsWanted = shadowsCheckbox.checked;
  let shadowsCurrentlyAdded = false;
  let playTimer = null;
  let apiKey = getApiKey();

  // Resort centroid — for sun-position math. Always available because
  // render.js stashes it before sun.js runs.
  const resortBbox = map._resortBbox || { minLon: 6.9, maxLon: 7.0, minLat: 45.4, maxLat: 45.5 };
  const centerLon = (resortBbox.minLon + resortBbox.maxLon) / 2;
  const centerLat = (resortBbox.minLat + resortBbox.maxLat) / 2;

  // Custom WebGL shadow layer (alternative to ShadeMap).
  let customShadow = null;
  if (SHADOW_ENGINE === "custom") {
    customShadow = new ShadowLayer({ opacity: 0.50 });
  }

  function currentSunDate() {
    const d = dateEl.valueAsDate || new Date();
    return new Date(Date.UTC(
      d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
      Math.floor(sunMinutes / 60) - 1, // CET → UTC
      sunMinutes % 60, 0, 0,
    ));
  }

  function updateCustomShadowSun() {
    if (!customShadow) return;
    const pos = sunPosition(currentSunDate(), centerLat, centerLon);
    customShadow.setSun(pos.azimuth, pos.altitude);
  }
  function fmtTime(m) {
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }
  function fmtDate(d) {
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  const trackMarker = document.getElementById("sun-track-marker");
  const sectionHeading = document.getElementById("sun-section-heading");
  const sunStatusLine = document.getElementById("sun-status-line");
  const sunShadowState = document.getElementById("sun-shadow-state");

  function updateExternalSunChrome() {
    const pct = (sunMinutes / 1440) * 100;
    if (timeLabel) {
      timeLabel.textContent = fmtTime(sunMinutes);
      timeLabel.style.left = pct + "%";
    }
    if (trackMarker) trackMarker.style.left = pct + "%";
    const d = dateEl.valueAsDate || new Date();
    if (sectionHeading) sectionHeading.textContent = `Sun · ${fmtDate(d)} · ${fmtTime(sunMinutes)}`;
    if (sunStatusLine) sunStatusLine.textContent = `${fmtDate(d)} · ${fmtTime(sunMinutes)}`;
  }

  function setSunMinutes(m) {
    sunMinutes = ((m % 1440) + 1440) % 1440;
    updateExternalSunChrome();
    if (shadeMap) shadeMap.setDate(currentSunDate());
    updateCustomShadowSun();
  }
  function shouldShowShadows() {
    if (SHADOW_ENGINE === "custom") return shadowsWanted && customShadow;
    return shadowsWanted && shadeMap;
  }
  function updateSunStatus() {
    let state = "off";
    if (SHADOW_ENGINE === "custom") {
      if (!customShadow) state = "off";
      else if (!customShadow.dem) state = "loading DEM…";
      else if (!shadowsWanted) state = "off";
      else state = "active (custom)";
    } else {
      if (!shadeMap) state = "no key";
      else if (!shadowsWanted) state = "off";
      else state = "active";
    }
    if (sunStatus) sunStatus.textContent = "Shadows " + state;
    if (sunShadowState) sunShadowState.textContent = state;
  }
  // Layers we always want on top of the ShadeMap render — the resort
  // mask first (so it hides shadows outside the resort), then the
  // graph overlays so they stay visible above the masked shadow.
  // Order in the array = paint order in the stack (later = on top).
  const TOP_LAYERS = [
    "shadow-mask-layer",
    "contour-lines", "contour-labels",
    "pistes-outline", "pistes-layer", "piste-labels",
    "lifts-casing", "lifts-layer", "lifts-down-layer", "lift-labels",
    "skates-layer",
    "stations-layer", "villages-layer", "villages-label",
    "user-route-layer", "route-leg-highlight-halo", "route-leg-highlight-layer",
    "anim-settled-layer",
  ];

  function promoteOverlaysAboveShade() {
    // ShadeMap was just added to the top of the layer stack. Move our
    // mask + every overlay to the very top in order, so each ends up
    // above ShadeMap (which then sits below them all).
    for (const id of TOP_LAYERS) {
      if (map.getLayer(id)) {
        try { map.moveLayer(id); } catch (e) {}
      }
    }
  }

  function applyShadowVisibility() {
    // Custom WebGL renderer path.
    if (SHADOW_ENGINE === "custom") {
      if (!customShadow) return;
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
      updateSunStatus();
      return;
    }

    // ShadeMap path (legacy / fallback).
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
    updateSunStatus();
  }

  // Pre-warm Mapterhorn DEM tiles in a buffer around the resort so
  // ShadeMap can sample distant terrain (peaks that cast shadows INTO
  // the resort at low sun angles) without a noticeable load stall.
  // Tiles land in the browser HTTP cache via plain fetch() — when
  // ShadeMap later requests them with an <img>, the cache serves them
  // instantly.
  function prewarmDemTiles() {
    const bbox = map._resortBbox;
    if (!bbox) return;
    const Z = 9;            // matches ShadeMap's terrainSource.maxZoom
    const BUFFER_TILES = 1; // ~76 km of buffer beyond the resort at z9
    function lon2tx(lon, z) {
      return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
    }
    function lat2ty(lat, z) {
      const r = lat * Math.PI / 180;
      return Math.floor(
        (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z),
      );
    }
    const x0 = lon2tx(bbox.minLon, Z) - BUFFER_TILES;
    const x1 = lon2tx(bbox.maxLon, Z) + BUFFER_TILES;
    const y0 = lat2ty(bbox.maxLat, Z) - BUFFER_TILES; // y inverted
    const y1 = lat2ty(bbox.minLat, Z) + BUFFER_TILES;
    let count = 0;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        // Fire and forget. We don't await; just fill the cache.
        fetch(`https://tiles.mapterhorn.com/${Z}/${x}/${y}.webp`, {
          mode: "cors",
          cache: "force-cache",
        }).catch(() => {});
        count++;
      }
    }
    console.log(`[sun] pre-warmed ${count} DEM tiles around resort at z${Z}`);
  }

  async function initCustomShadows() {
    if (!customShadow) return;
    // Add the layer up front so it's part of the style. It renders
    // nothing until DEM finishes loading + visibility is set.
    if (!map.getLayer(customShadow.id)) map.addLayer(customShadow);
    promoteOverlaysAboveShade();
    updateSunStatus();
    try {
      await customShadow.setBbox(resortBbox, { bufferKm: 12 });
      console.log(`[shadow] DEM ready: ${customShadow.dem.tilesLoaded} tiles, `
        + `maxElev ${Math.round(customShadow.dem.maxElev)}m`);
    } catch (e) {
      console.error("[shadow] DEM load failed:", e);
    }
    updateCustomShadowSun();
    applyShadowVisibility();
    updateSunStatus();
  }

  function initShadows() {
    if (SHADOW_ENGINE === "custom") {
      initCustomShadows();
      return;
    }
    if (!apiKey) {
      sunStatus.innerHTML =
        'No key. <a href="#" id="enter-key-link" style="color:#88c">Enter key</a> · ' +
        '<a href="https://shademap.app/about/" target="_blank" style="color:#88c">get free key</a>';
      shadowsCheckbox.disabled = true;
      const link = document.getElementById("enter-key-link");
      if (link) link.addEventListener("click", (e) => { e.preventDefault(); showKeyPrompt(); });
      return;
    }
    if (typeof ShadeMap === "undefined") {
      sunStatus.textContent = "ShadeMap plugin failed to load.";
      return;
    }
    shadeMap = new ShadeMap({
      date: currentSunDate(),
      color: "#01112f",
      opacity: 0.55,
      apiKey,
      terrainSource: {
        tileSize: 512,
        // maxZoom 9 means each DEM tile covers ~76 km — wide enough
        // that the resort and ALL the peaks that cast shadows into it
        // share a single tile. ShadeMap doesn't have to stitch
        // shadows across tile boundaries, which is what was causing
        // the harsh seams. Cost: shadow-edge precision goes to ~74 m
        // per pixel. For 3D alpine shadows that's fine.
        maxZoom: 9,
        getSourceUrl: ({ x, y, z }) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,
        getElevation: ({ r, g, b }) => r * 256 + g + b / 256 - 32768,
      },
    });
    // applyShadowVisibility decides whether to actually attach
  }

  // Touching any sun control turns shadows on (if they're off), but
  // doesn't change pitch — 3D + shadows is fine. The "binary 2D/3D"
  // behaviour we used to have is gone now that shadow rendering is
  // bounded to the resort domain and feasible in 3D.
  function engageSunMode() {
    if (!shadowsWanted) {
      shadowsWanted = true;
      shadowsCheckbox.checked = true;
      applyShadowVisibility();
    }
  }
  function disengageSunMode() {
    shadowsWanted = false;
    shadowsCheckbox.checked = false;
    applyShadowVisibility();
  }
  map._engageSunMode    = engageSunMode;
  map._disengageSunMode = disengageSunMode;

  function withEngage(fn) {
    return (...args) => { engageSunMode(); return fn(...args); };
  }

  // Discrete time buttons — each one also flips to 2D + shadows-on.
  document.getElementById("sun-h-minus").addEventListener("click", withEngage(() => setSunMinutes(sunMinutes - 60)));
  document.getElementById("sun-h-plus") .addEventListener("click", withEngage(() => setSunMinutes(sunMinutes + 60)));
  document.getElementById("sun-m-minus").addEventListener("click", withEngage(() => setSunMinutes(sunMinutes - 15)));
  document.getElementById("sun-m-plus") .addEventListener("click", withEngage(() => setSunMinutes(sunMinutes + 15)));
  document.getElementById("sun-now")    .addEventListener("click", withEngage(() => setSunMinutes(nowMinutes())));
  dateEl.addEventListener("change", () => {
    engageSunMode();
    updateExternalSunChrome();
    if (shadeMap) shadeMap.setDate(currentSunDate());
  });
  dateEl.addEventListener("focus", engageSunMode);

  // Play / stop
  function stopPlay() {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    playBtn.textContent = "▶";
    playBtn.title = "Animate one full day";
  }
  playBtn.addEventListener("click", () => {
    if (playTimer) { stopPlay(); return; }
    engageSunMode();
    playBtn.textContent = "⏸";
    playBtn.title = "Pause";
    playTimer = setInterval(() => setSunMinutes(sunMinutes + 5), 400);
  });

  shadowsCheckbox.addEventListener("change", (e) => {
    if (e.target.checked) engageSunMode();
    else disengageSunMode();
  });
  // Re-apply on pitch end purely to update the status text. We don't
  // auto-toggle shadows on pitch changes anymore — 3D shadows are
  // allowed.
  map.on("pitchend", updateSunStatus);
  map.on("pitch", updateSunStatus);

  gearBtn.addEventListener("click", showKeyPrompt);

  function showKeyPrompt() {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:2000;
      background:rgba(0,0,0,0.7);
      display:flex; align-items:center; justify-content:center;
    `;
    overlay.innerHTML = `
      <div style="background:#1f232b;color:#eee;padding:24px;border-radius:10px;
                  max-width:480px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.5);
                  font-family:-apple-system,BlinkMacSystemFont,sans-serif">
        <h2 style="margin:0 0 10px;font-size:16px">ShadeMap API key</h2>
        <p style="margin:0 0 14px;font-size:13px;color:#bbb;line-height:1.5">
          Required to render sun shadows. Free educational tier covers localhost
          / file:// use. Get a key
          <a href="https://shademap.app/about/" target="_blank"
             style="color:#88c">here</a>. Stored in this browser only.
        </p>
        <input id="key-input" type="text" placeholder="Paste your JWT here"
          style="width:100%;padding:8px;background:#111;color:#eee;
                 border:1px solid #555;border-radius:5px;font-size:13px;
                 font-family:ui-monospace,monospace;box-sizing:border-box">
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
          <button id="key-clear" style="background:#444;color:#eee;border:1px solid #666;
                  padding:6px 12px;border-radius:5px;font-size:12px;cursor:pointer">Clear saved</button>
          <button id="key-cancel" style="background:#333;color:#eee;border:1px solid #555;
                  padding:6px 12px;border-radius:5px;font-size:12px;cursor:pointer">Cancel</button>
          <button id="key-save" style="background:#0066ff;color:white;border:none;
                  padding:6px 14px;border-radius:5px;font-size:12px;cursor:pointer;
                  font-weight:600">Save &amp; reload</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector("#key-input");
    input.value = apiKey || "";
    input.focus(); input.select();
    overlay.querySelector("#key-cancel").onclick = () => overlay.remove();
    overlay.querySelector("#key-clear").onclick = () => {
      localStorage.removeItem("shademap_api_key");
      overlay.remove(); window.location.reload();
    };
    overlay.querySelector("#key-save").onclick = () => {
      const v = input.value.trim();
      if (v) localStorage.setItem("shademap_api_key", v);
      else   localStorage.removeItem("shademap_api_key");
      overlay.remove(); window.location.reload();
    };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") overlay.querySelector("#key-save").click();
      if (e.key === "Escape") overlay.remove();
    });
  }

  updateExternalSunChrome();
  initShadows();
  applyShadowVisibility();
  // Fire pre-warm a tick later so it doesn't block first paint.
  setTimeout(prewarmDemTiles, 300);

  // ── Time scrubber (Sun mode's primary time control) ───────────────
  const scrubberContainer = document.getElementById("time-scrubber");
  let scrubber = null;
  if (scrubberContainer) {
    scrubber = new TimeScrubber({
      container: scrubberContainer,
      onChange: (date) => {
        // Mirror the new date into the sidebar's date input + minutes
        // so the existing sun controls stay consistent.
        const local = new Date(date.getTime());
        const yyyy = local.getFullYear();
        const mm = String(local.getMonth() + 1).padStart(2, "0");
        const dd = String(local.getDate()).padStart(2, "0");
        dateEl.value = `${yyyy}-${mm}-${dd}`;
        const newMinutes = local.getHours() * 60 + local.getMinutes();
        sunMinutes = newMinutes;
        updateExternalSunChrome();
        if (shadeMap) shadeMap.setDate(date);
        updateCustomShadowSun();
        // Make sure shadows are showing as the user explores.
        engageSunMode();
      },
      sunPositionFn: (date) => sunPosition(date, centerLat, centerLon),
    });
    // Seed with "now" (or current date input + sunMinutes if already set).
    scrubber.setDate(currentSunDate(), { silent: true });

    // Expose a render-trigger so setMode in map.html can call it when
    // switching to Sun mode (the strip width is 0 while hidden).
    window._renderTimeScrubber = () => {
      if (scrubber) {
        // Re-seed with the latest sidebar state in case the user used
        // the sidebar buttons while in another mode.
        scrubber.setDate(currentSunDate(), { silent: true });
      }
    };

    // Resize observer so the SVG redraws to container width when the
    // bottom pane shows up or the window resizes.
    new ResizeObserver(() => scrubber.render()).observe(scrubberContainer);
  }
}
