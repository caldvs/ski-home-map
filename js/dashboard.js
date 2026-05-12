/**
 * Dashboard: two views over the WORLDS list.
 *
 *   - Tile grid: cards, default
 *   - Map: MapLibre with a clickable marker for each world. Marker is
 *     coloured by sub-region, navigates to map.html?world=<id> on click.
 *
 * The Tiles ↔ Map toggle lives in the header. Map is built lazily on
 * the first switch.
 */

import { WORLDS } from "./worlds.js";

const grid          = document.getElementById("world-grid");
const mapWrap       = document.getElementById("world-map-wrap");
const switchBtns    = document.querySelectorAll(".view-switch button");

// availability cache so both views agree on greyed-out state
const availability = new Map();

async function probe(url) {
  if (availability.has(url)) return availability.get(url);
  try {
    const r = await fetch(url, { method: "HEAD" });
    availability.set(url, r.ok);
    return r.ok;
  } catch (e) {
    availability.set(url, false);
    return false;
  }
}

// ─────────────── Tile grid ───────────────

for (const w of Object.values(WORLDS)) {
  const tile = document.createElement("a");
  tile.className = "world-tile loading";
  tile.href = "#";
  tile.innerHTML = `
    <div class="world-tile-banner ${w.bannerClass}"></div>
    <div class="world-tile-body">
      <h2>${w.name}${w.region ? `<span class="region-tag">${w.region}</span>` : ""}</h2>
      <p>${w.description}</p>
      <div class="world-stats">
        <span><strong>${w.stats.nodes}</strong> nodes</span>
        <span><strong>${w.stats.edges}</strong> edges</span>
        <span><strong>${w.stats.villages}</strong> villages</span>
      </div>
    </div>
  `;
  grid.appendChild(tile);

  probe(w.data).then((ok) => {
    tile.classList.remove("loading");
    if (ok) {
      tile.href = `./map.html?world=${encodeURIComponent(w.id)}`;
    } else {
      tile.classList.add("disabled");
      tile.querySelector("h2").innerHTML +=
        ' <span class="muted">(not built yet)</span>';
      tile.addEventListener("click", (e) => e.preventDefault());
    }
  });
}

// ─────────────── View switch ───────────────

let mapBuilt = false;
let dashboardMap = null;

function showView(name) {
  switchBtns.forEach((b) => {
    const on = b.dataset.view === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (name === "map") {
    grid.hidden = true;
    mapWrap.hidden = false;
    if (!mapBuilt) {
      mapBuilt = true;
      buildMap();
    } else if (dashboardMap) {
      // Map was hidden; MapLibre needs a resize after display:none lift
      requestAnimationFrame(() => dashboardMap.resize());
    }
  } else {
    grid.hidden = false;
    mapWrap.hidden = true;
  }
}
switchBtns.forEach((b) =>
  b.addEventListener("click", () => showView(b.dataset.view)));

// ─────────────── Map view ───────────────

function buildMap() {
  // Centre on Tarentaise / Vanoise. Bounds are auto-fit below.
  dashboardMap = new maplibregl.Map({
    container: "world-map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [6.7, 45.4],
    zoom: 9,
    maxPitch: 0,
    attributionControl: { compact: true },
  });
  dashboardMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  dashboardMap.addControl(new maplibregl.ScaleControl(), "bottom-right");

  // Only ever one popup open at a time on the dashboard map.
  let openPopup = null;

  dashboardMap.on("load", async () => {
    const bounds = new maplibregl.LngLatBounds();
    const all = Object.values(WORLDS);

    // Probe all worlds first so disabled state is applied to the marker
    await Promise.all(all.map((w) => probe(w.data)));

    for (const w of all) {
      const ok = availability.get(w.data);
      const [lon, lat] = w.initialView.center;
      bounds.extend([lon, lat]);

      const el = document.createElement("div");
      el.className = "world-marker " + (w.bannerClass || "");
      if (!ok) el.classList.add("disabled");
      el.title = w.name + (ok ? "" : " (not built yet)");

      const popupHtml = `
        <h3>${w.name}</h3>
        <div class="region">${w.region || ""}</div>
        <p>${w.description}</p>
        <div class="stats">
          ${w.stats.nodes} nodes · ${w.stats.edges} edges · ${w.stats.villages} villages
        </div>
        ${ok
          ? `<a class="open-btn" href="./map.html?world=${encodeURIComponent(w.id)}">Go here →</a>`
          : `<div style="margin-top:6px;color:#c66;font-size:11px">Graph not built yet.</div>`
        }
      `;
      const popup = new maplibregl.Popup({
        offset: 14,
        closeButton: true,
        closeOnClick: true,
        className: "world-popup",
        maxWidth: "260px",
      }).setHTML(popupHtml);

      popup.on("close", () => {
        if (openPopup === popup) openPopup = null;
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lon, lat])
        .setPopup(popup)
        .addTo(dashboardMap);

      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        // Close any other open popup before opening this one
        if (openPopup && openPopup !== popup) openPopup.remove();
        if (openPopup === popup) {
          popup.remove();
          openPopup = null;
        } else {
          marker.togglePopup();
          openPopup = popup;
        }
      });
    }

    if (!bounds.isEmpty()) {
      dashboardMap.fitBounds(bounds, { padding: 60, maxZoom: 11, duration: 0 });
    }
  });
}

// Default view: tiles
showView("grid");
