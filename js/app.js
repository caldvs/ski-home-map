/**
 * Map view entry point. Loaded by map.html.
 *
 * Reads ?world=<id> from the URL, looks up the world preset in worlds.js,
 * fetches the graph JSON, initialises the MapLibre map + layers + routing +
 * sun controls + the chrome readouts (tag, stats, layer counts).
 */

import { WORLDS } from "./worlds.js?v=20260513c";
import { loadGraph } from "./graph.js";
import { initMap, addBaseLayers, addGraphLayers, wireLayerToggles } from "./render.js";
import { wireRouting, wirePerfOverlay } from "./ui.js?v=20260513";
import { wireSun } from "./sun.js";

const params = new URLSearchParams(window.location.search);
const worldId = params.get("world") || "tignes";
const world = WORLDS[worldId];

if (!world) {
  document.body.innerHTML =
    `<div style="padding:40px;color:#eee;background:#0c1014;height:100vh;font-family:sans-serif">
       <h1>Unknown world: ${worldId}</h1>
       <p><a href="./index.html" style="color:#88c">Back to dashboard</a></p>
     </div>`;
  throw new Error("unknown world");
}

// Region for the sidebar tag, with the department suffix shared across Savoie.
const sidebarTag = (world.region ? `${world.region} · Savoie` : "Savoie").toUpperCase();
const backLinkLabel = world.name.split(" / ")[0];

document.getElementById("world-title").textContent = world.name;
document.getElementById("sidebar-tag").textContent = sidebarTag;
document.getElementById("back-link-resort").textContent = backLinkLabel;

const titleEl = document.querySelector("title");
if (titleEl) titleEl.textContent = `${world.name} · ski-home-map`;

const map = initMap("map", world.initialView);
const initialView = world.initialView;

window._skihomeMap = map;

function fmtNum(n) {
  if (typeof n !== "number") return n;
  if (n >= 10000) return n.toLocaleString("fr-FR").replace(/,/g, " ");
  return String(n);
}

function fillStat(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = fmtNum(value);
}

map.on("load", async () => {
  try {
    const graph = await loadGraph(world.data);

    // Compute breakdowns from the raw graph
    const edges = graph.raw.edges;
    const lifts = new Set();
    let pisteCount = 0;
    for (const e of edges) {
      if (e.type === "lift" && e.name) lifts.add(e.name);
      if (e.type === "run" || e.type === "connection") pisteCount++;
    }
    const stations = graph.stationsFC ? graph.stationsFC.features.length : 0;
    const villageNames = Object.keys(graph.raw.villages || {});

    // Sidebar stats
    fillStat("stat-nodes", graph.stats.nodes);
    fillStat("stat-edges", graph.stats.edges);
    fillStat("stat-lifts", lifts.size);
    fillStat("stat-pistes", pisteCount);

    // Sub-villages line (max 4 to keep the line short)
    const subEl = document.getElementById("sidebar-sub-villages");
    if (villageNames.length) {
      subEl.textContent = villageNames.slice(0, 4).join(" · ")
        + (villageNames.length > 4 ? ` · +${villageNames.length - 4}` : "");
    } else {
      subEl.textContent = "";
    }

    // Layer count chips
    fillStat("layer-count-pistes",   pisteCount);
    fillStat("layer-count-lifts",    lifts.size);
    fillStat("layer-count-stations", stations);
    fillStat("layer-count-villages", villageNames.length);

    // Keep legacy summary for compat
    document.getElementById("world-summary").textContent =
      `${graph.stats.nodes} nodes · ${graph.stats.edges} edges · ${graph.stats.villages} villages`;

    addBaseLayers(map);
    addGraphLayers(map, graph);
    wireLayerToggles(map);
    wireRouting(map, graph);
    wireSun(map);
    wirePerfOverlay(map);

    document.getElementById("toggle-3d").addEventListener("click", () => {
      const pitchNow = map.getPitch();
      const goingIn3D = pitchNow < 30;
      map.easeTo({
        pitch: goingIn3D ? 65 : 0,
        bearing: goingIn3D ? initialView.bearing : 0,
        duration: 800,
      });
      const btn = document.getElementById("toggle-3d");
      btn.textContent = goingIn3D ? "2D · top-down" : "3D · 42°";
    });
    document.getElementById("reset-view").addEventListener("click", () => {
      map.flyTo({
        center: initialView.center,
        zoom: initialView.zoom,
        pitch: initialView.pitch,
        bearing: initialView.bearing,
        duration: 800,
      });
    });
    const recenterBtn = document.getElementById("recenter-view");
    if (recenterBtn) {
      recenterBtn.addEventListener("click", () => {
        map.flyTo({ center: initialView.center, duration: 500 });
      });
    }
  } catch (err) {
    console.error(err);
    const infoEl = document.getElementById("user-route-info");
    if (infoEl) {
      infoEl.innerHTML =
        `<div style="color:var(--accent)">Failed to load world data: ${err.message}</div>`;
    }
  }
});
