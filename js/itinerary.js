/**
 * Step-by-step itinerary for a routed path.
 *
 * Collapses consecutive edges of the same lift / piste / connector into
 * single "legs", so a piste that the graph splits into 5 segments shows
 * as one "Ski Génépy" step. Output is designed to be skim-readable on
 * mountain — name + distance + elev delta, one line per leg.
 */

const LIFT_TYPE_LABEL = {
  chair_lift:   "Chairlift",
  gondola:      "Gondola",
  cable_car:    "Cable car",
  funicular:    "Funicular",
  drag_lift:    "Drag lift",
  "t-bar":      "T-bar",
  platter:      "Platter",
  rope_tow:     "Rope tow",
  magic_carpet: "Magic carpet",
};
const DIFFICULTY_LABEL = {
  novice:       "green",
  easy:         "blue",
  intermediate: "red",
  advanced:     "black",
  expert:       "black",
  freeride:     "freeride",
};
const DIFFICULTY_COLOUR = {
  novice:       "#00b050",
  easy:         "#1e88e5",
  intermediate: "#e53935",
  advanced:     "#2c2c2c",
  expert:       "#2c2c2c",
  freeride:     "#ff8800",
};

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function edgeLengthM(edge) {
  const g = edge.g;
  let len = 0;
  for (let i = 1; i < g.length; i++) {
    len += haversine(g[i-1][0], g[i-1][1], g[i][0], g[i][1]);
  }
  return len;
}

function legKey(edge) {
  // Group by edge type + name + difficulty/lift_type. Walks share a key
  // so consecutive walks merge into one "Walk" leg.
  if (edge.ty === "skate" || edge.ty === "walk") return `${edge.ty}::`;
  return `${edge.ty}:${edge.n || ""}:${edge.d || ""}:${edge.lt || ""}`;
}

/**
 * Build itinerary legs from a path (array of edge indices).
 * Returns [{ type, name, lift_type, difficulty, distM, elevDelta,
 *            startElev, endElev, startNodeId, endNodeId, edgeCount }]
 */
export function buildItinerary(graph, path) {
  const legs = [];
  let cur = null;
  for (const ei of path) {
    const e = graph.routingEdges[ei];
    const key = legKey(e);
    const len = edgeLengthM(e);
    const elevA = graph.routingNodes[e.f][2];
    const elevB = graph.routingNodes[e.t][2];
    if (cur && cur._key === key) {
      cur.distM += len;
      cur.endElev = elevB;
      cur.endNodeId = e.t;
      cur.edgeCount += 1;
    } else {
      if (cur) legs.push(finalise(cur));
      cur = {
        _key: key,
        type: e.ty, name: e.n, lift_type: e.lt, difficulty: e.d,
        startElev: elevA, endElev: elevB,
        startNodeId: e.f, endNodeId: e.t,
        distM: len, edgeCount: 1,
      };
    }
  }
  if (cur) legs.push(finalise(cur));
  return legs;
}

function finalise(leg) {
  delete leg._key;
  leg.elevDelta = leg.endElev - leg.startElev;
  return leg;
}

function iconFor(leg) {
  // SVG symbols rather than emoji for crisp rendering at any zoom.
  if (leg.type === "lift") {
    return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3 13 L13 3" stroke="#ff6f00" stroke-width="2" stroke-linecap="round"/>
      <circle cx="3" cy="13" r="1.5" fill="#ff6f00"/>
      <circle cx="13" cy="3" r="1.5" fill="#ff6f00"/>
      <path d="M8 11 L8 13.5 L6 13.5 L10 13.5" stroke="#ff6f00" stroke-width="1.2" fill="none"/>
    </svg>`;
  }
  if (leg.type === "lift_down") {
    return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3 3 L13 13" stroke="#ff6f00" stroke-width="2" stroke-linecap="round" stroke-dasharray="2,2"/>
    </svg>`;
  }
  if (leg.type === "skate" || leg.type === "walk") {
    const c = leg.type === "walk" ? "#7c4dff" : "#9aa3aa";
    return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2 8 L13 8 M10 5 L13 8 L10 11" stroke="${c}" stroke-width="2" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  // run / connection — coloured triangle pointing down
  const colour = DIFFICULTY_COLOUR[leg.difficulty] || "#888";
  return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path d="M3 4 L13 4 L8 13 Z" fill="${colour}" stroke="#fff" stroke-width="0.8"/>
  </svg>`;
}

function labelFor(leg) {
  const name = (leg.name || "").trim();
  if (leg.type === "lift") {
    const liftType = LIFT_TYPE_LABEL[leg.lift_type] || "Lift";
    return name
      ? `<strong>${escapeHtml(name)}</strong> <span class="leg-sub">(${liftType.toLowerCase()})</span>`
      : `<strong>${liftType}</strong>`;
  }
  if (leg.type === "lift_down") {
    const liftType = LIFT_TYPE_LABEL[leg.lift_type] || "Lift";
    return name
      ? `<strong>${escapeHtml(name)}</strong> <span class="leg-sub">(${liftType.toLowerCase()} down)</span>`
      : `<strong>${liftType} down</strong>`;
  }
  if (leg.type === "skate") return `<strong>Skate across</strong>`;
  if (leg.type === "walk")  return `<strong>Walk</strong>`;
  // run / connection
  const diff = DIFFICULTY_LABEL[leg.difficulty];
  if (name) {
    return diff
      ? `<strong>${escapeHtml(name)}</strong> <span class="leg-sub">(${diff})</span>`
      : `<strong>${escapeHtml(name)}</strong>`;
  }
  return diff ? `<strong>${diff[0].toUpperCase()}${diff.slice(1)} piste</strong>` : `<strong>Piste</strong>`;
}

function verbFor(leg) {
  if (leg.type === "lift")      return "Ride";
  if (leg.type === "lift_down") return "Ride down";
  if (leg.type === "skate")     return "Slide";
  if (leg.type === "walk")      return "Walk";
  return "Ski";
}

function formatDist(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function formatElev(d) {
  const r = Math.round(d);
  if (r === 0) return "level";
  return r > 0 ? `↑ ${r} m` : `↓ ${-r} m`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Render the itinerary into `container`. Returns a dispose() function.
 * If `onHover(leg, lat, lon)` is supplied, called when the user hovers
 * a leg row (used to highlight on the map).
 */
export function renderItinerary(container, graph, path, opts = {}) {
  container.innerHTML = "";
  container.hidden = false;

  const legs = buildItinerary(graph, path);
  if (!legs.length) { container.hidden = true; return () => {}; }

  const totalDist = legs.reduce((s, l) => s + l.distM, 0);
  const totalDown = legs.reduce((s, l) => s + (l.elevDelta < 0 ? -l.elevDelta : 0), 0);
  const totalUp   = legs.reduce((s, l) => s + (l.elevDelta > 0 ?  l.elevDelta : 0), 0);

  let html = `<div class="itin-summary">`
           + `${legs.length} steps · ${formatDist(totalDist)} · `
           + `<span class="itin-down">↓ ${Math.round(totalDown)} m</span> · `
           + `<span class="itin-up">↑ ${Math.round(totalUp)} m</span>`
           + `</div>`;
  html += `<ol class="itin-list">`;
  legs.forEach((leg, i) => {
    const verb = verbFor(leg);
    const label = labelFor(leg);
    html += `<li class="itin-step" data-step="${i}">`
          + `<span class="itin-num">${i + 1}</span>`
          + `<span class="itin-icon">${iconFor(leg)}</span>`
          + `<span class="itin-body">`
          +   `<span class="itin-action">${verb} ${label}</span>`
          +   `<span class="itin-detail">${formatDist(leg.distM)} · ${formatElev(leg.elevDelta)}</span>`
          + `</span>`
          + `</li>`;
  });
  html += `</ol>`;

  container.innerHTML = html;

  // Hover wiring — map highlight, if caller wants it.
  if (typeof opts.onHover === "function") {
    container.querySelectorAll(".itin-step").forEach((row) => {
      row.addEventListener("mouseenter", () => {
        const idx = parseInt(row.dataset.step, 10);
        const leg = legs[idx];
        const n = graph.routingNodes[leg.endNodeId];
        opts.onHover(leg, n[1], n[0]); // (leg, lat, lon)
      });
      row.addEventListener("mouseleave", () => opts.onHover(null));
    });
  }

  return function dispose() {
    container.innerHTML = "";
    container.hidden = true;
  };
}

export function disposeItinerary(container) {
  if (container) {
    container.innerHTML = "";
    container.hidden = true;
  }
}
