/**
 * Map view entry point. Loaded by map.html.
 *
 * Reads ?world=<id> from the URL, looks up the world preset in worlds.js,
 * fetches the graph JSON, initialises the MapLibre map + layers + routing +
 * sun controls.
 */

import { WORLDS } from "./worlds.js";
import { loadGraph } from "./graph.js";
import { initMap, addBaseLayers, addGraphLayers, wireLayerToggles } from "./render.js";
import { wireRouting, wirePerfOverlay } from "./ui.js";
import { wireSun, getShadeMap } from "./sun.js";

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

document.getElementById("world-title").textContent = world.name;
document.getElementById("world-summary").textContent =
  `${world.stats.nodes} nodes · ${world.stats.edges} edges · ${world.stats.villages} villages`;

const titleEl = document.querySelector("title");
if (titleEl) titleEl.textContent = `${world.name} · ski-home-map`;

const map = initMap("map", world.initialView);
const initialView = world.initialView;

map.on("load", async () => {
  try {
    const graph = await loadGraph(world.data);

    // Update summary with actual loaded counts
    document.getElementById("world-summary").textContent =
      `${graph.stats.nodes} nodes · ${graph.stats.edges} edges · ${graph.stats.villages} villages`;

    addBaseLayers(map);
    addGraphLayers(map, graph);
    wireLayerToggles(map);
    wireRouting(map, graph);
    wireSun(map);
    wirePerfOverlay(map, getShadeMap);

    // Reset-view + 3D toggle buttons
    document.getElementById("toggle-3d").addEventListener("click", () => {
      const pitchNow = map.getPitch();
      map.easeTo({
        pitch: pitchNow < 30 ? 65 : 0,
        bearing: pitchNow < 30 ? initialView.bearing : 0,
        duration: 800,
      });
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
  } catch (err) {
    console.error(err);
    document.getElementById("user-route-info").innerHTML =
      `<div style="color:#c33">Failed to load world data: ${err.message}</div>`;
  }
});
