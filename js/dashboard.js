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

import { WORLDS } from "./worlds.js?v=20260513c";

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

// World status drives tile rendering:
//   "built"      → clickable, normal tile
//   "planned"    → Coming Soon chip, not clickable
//   "needs-data" → Data-fixes-pending chip, not clickable (yet)
// A missing status falls back to probing the data URL (legacy behaviour).
function statusChip(status) {
  if (status === "planned") return '<span class="status-chip planned">Coming soon</span>';
  if (status === "needs-data") return '<span class="status-chip needs-data">Data fixes pending</span>';
  return "";
}

// Region ordering: Alpes du Nord (north → south) · Alpes du Centre/Sud
// · Autres massifs. Each entry is the bannerClass key, plus the macro
// section it belongs to, the display title, and a tagline of headline
// destinations to give visitors a sense of what's inside.
const REGION_ORDER = [
  { key: "haute-savoie",   macro: "alpes-nord", title: "Haute-Savoie",   blurb: "Mont-Blanc valley · Chamonix · Aravis · Portes du Soleil" },
  { key: "beaufortain",    macro: "alpes-nord", title: "Beaufortain",    blurb: "Espace Diamant · Arêches-Beaufort" },
  { key: "tarentaise",     macro: "alpes-nord", title: "Tarentaise",     blurb: "Tignes · Trois Vallées · Les Arcs · La Plagne" },
  { key: "vanoise",        macro: "alpes-nord", title: "Vanoise",        blurb: "Pralognan · Valmorel · Le Grand Domaine" },
  { key: "maurienne",      macro: "alpes-nord", title: "Maurienne",      blurb: "Val Cenis · Galibier-Thabor · Aussois · La Norma" },
  { key: "isere",          macro: "alpes-sud",  title: "Isère",          blurb: "Alpe d'Huez · Les Deux Alpes · Vercors" },
  { key: "hautes-alpes",   macro: "alpes-sud",  title: "Hautes-Alpes",   blurb: "Serre Chevalier · Forêt Blanche · Dévoluy" },
  { key: "southern-alps",  macro: "alpes-sud",  title: "Alpes du Sud",   blurb: "Pra Loup · Auron · Isola 2000" },
  { key: "pyrenees",       macro: "autres",     title: "Pyrénées",       blurb: "Grand Tourmalet · Saint-Lary · Font-Romeu · Cauterets" },
  { key: "jura",           macro: "autres",     title: "Jura",           blurb: "Métabief · Les Rousses · Monts Jura" },
  { key: "vosges",         macro: "autres",     title: "Vosges",         blurb: "Gérardmer · La Bresse · Le Markstein" },
  { key: "massif-central", macro: "autres",     title: "Massif Central", blurb: "Le Mont-Dore · Super-Besse · Le Lioran" },
];

const MACRO_TITLES = {
  "alpes-nord": "Alpes du Nord",
  "alpes-sud":  "Alpes du Sud",
  "autres":     "Autres massifs",
};

// Bucket the worlds by bannerClass so each section can render in one go.
const worldsByRegion = new Map();
for (const w of Object.values(WORLDS)) {
  const key = w.bannerClass || "other";
  if (!worldsByRegion.has(key)) worldsByRegion.set(key, []);
  worldsByRegion.get(key).push(w);
}

function buildTile(w) {
  const tile = document.createElement("a");
  const status = w.status || "auto";
  tile.className = "world-tile";
  if (status === "auto") tile.classList.add("loading");
  if (status === "planned") tile.classList.add("disabled", "planned");
  if (status === "needs-data") tile.classList.add("disabled", "needs-data");
  tile.href = "#";

  const stats = w.stats || {};
  const statsLine = (stats.nodes != null || stats.edges != null || stats.villages != null)
    ? `<div class="world-stats">
         <span><strong>${stats.nodes ?? "—"}</strong> nodes</span>
         <span><strong>${stats.edges ?? "—"}</strong> edges</span>
         <span><strong>${stats.villages ?? "—"}</strong> villages</span>
       </div>`
    : "";

  tile.innerHTML = `
    <div class="world-tile-banner ${w.bannerClass || ""}"></div>
    <div class="world-tile-body">
      <h2>${w.name}${statusChip(status)}${w.region ? `<span class="region-tag">${w.region}</span>` : ""}</h2>
      <p>${w.description || ""}</p>
      ${statsLine}
    </div>
  `;

  if (status === "built") {
    tile.href = `./map.html?world=${encodeURIComponent(w.id)}`;
  } else if (status === "planned") {
    tile.addEventListener("click", (e) => {
      if (tile.classList.contains("disabled")) e.preventDefault();
    });
    probe(w.data).then((ok) => {
      if (!ok) return;
      tile.classList.remove("disabled", "planned");
      const chip = tile.querySelector(".status-chip");
      if (chip) chip.remove();
      tile.href = `./map.html?world=${encodeURIComponent(w.id)}`;
    });
  } else if (status === "needs-data") {
    tile.addEventListener("click", (e) => e.preventDefault());
  } else {
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
  return tile;
}

// Render: walk REGION_ORDER, emit a macro header when the macro changes,
// then a region section for each region that has at least one world.
let currentMacro = null;
for (const region of REGION_ORDER) {
  const worlds = worldsByRegion.get(region.key) || [];
  if (worlds.length === 0) continue;

  if (region.macro !== currentMacro) {
    currentMacro = region.macro;
    const macroHeader = document.createElement("h2");
    macroHeader.className = "macro-header";
    macroHeader.textContent = MACRO_TITLES[region.macro] || "";
    grid.appendChild(macroHeader);
  }

  const section = document.createElement("section");
  section.className = "region-section";
  section.dataset.region = region.key;

  const builtCount   = worlds.filter((w) => w.status === "built").length;
  const plannedCount = worlds.length - builtCount;
  const countLabel =
    plannedCount === 0 ? `${worlds.length} resorts` :
    builtCount === 0   ? `${plannedCount} coming soon` :
    `${builtCount} built · ${plannedCount} coming soon`;

  const header = document.createElement("header");
  header.className = "region-header";
  header.innerHTML = `
    <span class="region-dot ${region.key}"></span>
    <h3>${region.title}</h3>
    <span class="region-count">${countLabel}</span>
    <p class="region-blurb">${region.blurb}</p>
  `;
  section.appendChild(header);

  const regionGrid = document.createElement("div");
  regionGrid.className = "region-grid";
  for (const w of worlds) regionGrid.appendChild(buildTile(w));
  section.appendChild(regionGrid);

  grid.appendChild(section);
}

// Any worlds with a bannerClass not in REGION_ORDER fall into a catch-all
// section at the bottom so they're not silently dropped.
const handledKeys = new Set(REGION_ORDER.map((r) => r.key));
const orphans = [];
for (const [key, ws] of worldsByRegion) {
  if (!handledKeys.has(key)) orphans.push(...ws);
}
if (orphans.length) {
  const section = document.createElement("section");
  section.className = "region-section";
  section.dataset.region = "other";
  const header = document.createElement("header");
  header.className = "region-header";
  header.innerHTML = `<h3>Other</h3><span class="region-count">${orphans.length} resort${orphans.length === 1 ? "" : "s"}</span>`;
  section.appendChild(header);
  const regionGrid = document.createElement("div");
  regionGrid.className = "region-grid";
  for (const w of orphans) regionGrid.appendChild(buildTile(w));
  section.appendChild(regionGrid);
  grid.appendChild(section);
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
  // Centre on metropolitan France. Bounds are auto-fit to markers below;
  // this is just the brief initial frame before marker placement runs.
  dashboardMap = new maplibregl.Map({
    container: "world-map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [3.5, 46.0],
    zoom: 5.2,
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

    // Only probe worlds that don't declare a status — built/planned/needs-data
    // are authoritative and skip the network round-trip.
    await Promise.all(
      all.filter((w) => !w.status).map((w) => probe(w.data)),
    );

    for (const w of all) {
      const status = w.status
        || (availability.get(w.data) ? "built" : "needs-data");
      const ok = status === "built";
      const [lon, lat] = w.initialView.center;
      bounds.extend([lon, lat]);

      const el = document.createElement("div");
      el.className = "world-marker " + (w.bannerClass || "");
      if (!ok) el.classList.add("disabled", status);
      const titleSuffix =
        status === "planned" ? " (coming soon)" :
        status === "needs-data" ? " (data fixes pending)" : "";
      el.title = w.name + titleSuffix;

      const stats = w.stats || {};
      const statsLine = (stats.nodes != null || stats.edges != null || stats.villages != null)
        ? `<div class="stats">
             ${stats.nodes ?? "—"} nodes · ${stats.edges ?? "—"} edges · ${stats.villages ?? "—"} villages
           </div>`
        : "";

      const footer = ok
        ? `<a class="open-btn" href="./map.html?world=${encodeURIComponent(w.id)}">Go here →</a>`
        : status === "planned"
          ? `<div class="popup-footer planned">Coming soon</div>`
          : `<div class="popup-footer needs-data">Data fixes pending</div>`;

      const popupHtml = `
        <h3>${w.name}</h3>
        <div class="region">${w.region || ""}</div>
        <p>${w.description || ""}</p>
        ${statsLine}
        ${footer}
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
      dashboardMap.fitBounds(bounds, { padding: 60, maxZoom: 8, duration: 0 });
    }
  });
}

// Default view: tiles
showView("grid");
