/**
 * Dashboard: lay out the world tiles. Clicking a tile navigates to
 * map.html?world=<id> where app.js takes over.
 */

import { WORLDS } from "./worlds.js";

const grid = document.getElementById("world-grid");

// Probe each world's data file at page load and grey out any that aren't
// available yet (e.g. before scripts/build_data.py has been run).
async function isAvailable(url) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok;
  } catch (e) {
    return false;
  }
}

for (const w of Object.values(WORLDS)) {
  const tile = document.createElement("a");
  tile.className = "world-tile loading";
  tile.href = "#";
  tile.innerHTML = `
    <div class="world-tile-banner ${w.bannerClass}"></div>
    <div class="world-tile-body">
      <h2>${w.name}</h2>
      <p>${w.description}</p>
      <div class="world-stats">
        <span><strong>${w.stats.nodes}</strong> nodes</span>
        <span><strong>${w.stats.edges}</strong> edges</span>
        <span><strong>${w.stats.villages}</strong> villages</span>
      </div>
    </div>
  `;
  grid.appendChild(tile);

  // Async availability probe
  isAvailable(w.data).then((available) => {
    if (available) {
      tile.classList.remove("loading");
      tile.href = `./map.html?world=${encodeURIComponent(w.id)}`;
    } else {
      tile.classList.remove("loading");
      tile.classList.add("disabled");
      tile.querySelector("h2").innerHTML +=
        ' <span class="muted">(not built yet)</span>';
      tile.addEventListener("click", (e) => e.preventDefault());
    }
  });
}
