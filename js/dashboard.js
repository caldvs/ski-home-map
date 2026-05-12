/**
 * Dashboard: lay out the world tiles. Clicking a tile navigates to
 * map.html?world=<id> where app.js takes over.
 */

import { WORLDS } from "./worlds.js";

const grid = document.getElementById("world-grid");

for (const w of Object.values(WORLDS)) {
  const tile = document.createElement("a");
  tile.className = "world-tile" + (w.comingSoon ? " disabled" : "");
  tile.href = w.comingSoon ? "#" : `./map.html?world=${encodeURIComponent(w.id)}`;
  if (w.comingSoon) {
    tile.addEventListener("click", (e) => e.preventDefault());
  }
  tile.innerHTML = `
    <div class="world-tile-banner ${w.bannerClass}${w.comingSoon ? " coming-soon" : ""}"></div>
    <div class="world-tile-body">
      <h2>${w.name}${w.comingSoon ? " <span class='muted'>(coming soon)</span>" : ""}</h2>
      <p>${w.description}</p>
      <div class="world-stats">
        <span><strong>${w.stats.nodes}</strong> nodes</span>
        <span><strong>${w.stats.edges}</strong> edges</span>
        <span><strong>${w.stats.villages}</strong> villages</span>
      </div>
    </div>
  `;
  grid.appendChild(tile);
}
