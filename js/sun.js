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

// ShadeMap API key — resolved at module load with this fallback chain:
//   1. ./config.local.js   (gitignored, developer's own key)
//   2. ./config.js         (committed at build time by a CI step)
//   3. localStorage         (set by the in-app prompt the first time the
//                            user opens Sun mode without a key)
//
// The free ShadeMap educational tier is signed up for at https://shademap.app
// — paste the JWT into the prompt that appears in the Sun panel when no
// key is set, and it'll be saved per-origin in localStorage.
const SHADEMAP_KEY_STORAGE = "ski:shademap-key";

// Only attempt the config.local.js dynamic import on dev origins. On the
// deployed site it will always be absent, and the failed import prints a
// 404 in the network panel that no try/catch can swallow.
function _isDevOrigin() {
  if (typeof location === "undefined") return false;
  const h = location.hostname;
  return location.protocol === "file:"
    || h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0"
    || h.endsWith(".local");
}

async function _resolveShadeMapKey() {
  let key = "";
  if (_isDevOrigin()) {
    try {
      const mod = await import("./config.local.js");
      key = (mod.SHADEMAP_API_KEY || "").trim();
    } catch (e) { /* config.local.js absent on this dev box — fine */ }
  }
  // localStorage is the deployed-user path: paste a key once via the
  // Sun-panel prompt, it sticks per-origin.
  if (!key && typeof localStorage !== "undefined") {
    key = (localStorage.getItem(SHADEMAP_KEY_STORAGE) || "").trim();
  }
  return key;
}
let SHADEMAP_API_KEY = await _resolveShadeMapKey();

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
  // Note: stations-layer, piste-labels and lift-labels are deliberately
  // placed AFTER the route layers so route-member lift termini and piste /
  // lift names render on top of the route line.
  const TOP_LAYERS = [
    "shadow-mask-layer",
    "contour-lines", "contour-labels",
    "pistes-outline", "pistes-layer",
    "lifts-casing", "lifts-layer", "lifts-down-layer",
    "skates-layer",
    "villages-layer", "villages-label",
    "user-route-piste-base", "user-route-piste-dash", "user-route-lift",
    "user-route-arrows", "user-route-transitions-layer",
    "start-approach-layer",
    "route-leg-highlight-halo", "route-leg-highlight-layer",
    "anim-settled-layer",
    "stations-layer", "piste-labels", "lift-labels",
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

  // Inline prompt rendered into the Sun panel when no ShadeMap key is
  // available. Saves to localStorage on submit + re-initialises ShadeMap.
  function renderKeyPrompt() {
    const host = document.getElementById("sun-section")
      ?? document.querySelector(".sun-section .sun-body")
      ?? document.querySelector(".sun-body");
    if (!host || host.querySelector(".shademap-key-prompt")) return;
    const el = document.createElement("div");
    el.className = "shademap-key-prompt";
    el.innerHTML = `
      <div style="padding:10px 14px;font-size:12px;line-height:1.45">
        <strong>Shadows need a free ShadeMap key.</strong>
        Get one (educational tier, free) at
        <a href="https://shademap.app" target="_blank" rel="noopener">shademap.app</a>,
        then paste it below. It's stored per-origin in your browser only.
        <div style="display:flex;gap:6px;margin-top:8px">
          <input type="text" class="shademap-key-input"
                 placeholder="eyJhbGciOi…"
                 style="flex:1;min-width:0;font:11px ui-monospace, monospace;
                        padding:5px 8px;border:1px solid var(--l-line,#ccc);
                        border-radius:3px;background:var(--l-bg,#fff);color:inherit">
          <button class="shademap-key-save"
                  style="font-size:11px;padding:5px 12px;border:1px solid #1a1a1a;
                         border-radius:3px;background:#1a1a1a;color:#fff;cursor:pointer">
            Save
          </button>
        </div>
        <div class="shademap-key-status muted" style="margin-top:6px;font-size:11px;color:#888"></div>
      </div>
    `;
    host.appendChild(el);
    const input = el.querySelector(".shademap-key-input");
    const status = el.querySelector(".shademap-key-status");
    const save = el.querySelector(".shademap-key-save");
    const commit = () => {
      const key = (input.value || "").trim();
      if (!key) { status.textContent = "Paste a key first."; return; }
      try { localStorage.setItem(SHADEMAP_KEY_STORAGE, key); }
      catch (e) { status.textContent = "localStorage not available."; return; }
      SHADEMAP_API_KEY = key;
      el.remove();
      initShadeMap();
      applyShadowVisibility();
    };
    save.addEventListener("click", commit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
  }

  function initShadeMap() {
    if (typeof ShadeMap === "undefined") {
      console.warn("[shadows] ShadeMap script not loaded — shadows disabled.");
      return;
    }
    if (!SHADEMAP_API_KEY) {
      // Don't spam the console — the prompt itself tells the user what
      // to do. Console message remains for developers debugging CI.
      console.info("[shadows] no SHADEMAP_API_KEY yet — prompting in Sun panel.");
      renderKeyPrompt();
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
      (window._ski = window._ski || {}).shadowDem = demSampler;
      window._shadowDem = demSampler;  // legacy alias
      if (typeof window._refreshElevation === "function") {
        try { window._refreshElevation(); } catch (e) {}
      }
    } catch (e) {
      console.error("[shadows] DEM sampler load failed:", e);
    }
  }

  // Exposed for the mode switcher in map.html.
  const setShadowsEnabled = (on) => {
    shadowsWanted = !!on;
    applyShadowVisibility();
  };
  (window._ski = window._ski || {}).setShadowsEnabled = setShadowsEnabled;
  window._setShadowsEnabled = setShadowsEnabled;  // legacy alias

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
    const renderTimeScrubber = () => {
      if (scrubber) scrubber.setDate(currentDate, { silent: true });
    };
    (window._ski = window._ski || {}).renderTimeScrubber = renderTimeScrubber;
    window._renderTimeScrubber = renderTimeScrubber;  // legacy alias
    new ResizeObserver(() => scrubber.render()).observe(scrubberContainer);
  }

  initDemSampler();
  initShadeMap();
}
