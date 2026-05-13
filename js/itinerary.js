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

function pipColourFor(leg) {
  // Coloured square pip per the design — piste difficulty colour for runs,
  // lift orange for lifts, grey for skates, purple for walks.
  if (leg.type === "lift" || leg.type === "lift_down") return "#e87a25";
  if (leg.type === "skate") return "#9aa3aa";
  if (leg.type === "walk")  return "#7c4dff";
  return DIFFICULTY_COLOUR[leg.difficulty] || "#888";
}

function nameFor(leg) {
  const name = (leg.name || "").trim();
  if (leg.type === "lift") {
    const liftType = LIFT_TYPE_LABEL[leg.lift_type] || "Lift";
    return name ? `${name} ${liftType.toLowerCase()}` : liftType;
  }
  if (leg.type === "lift_down") {
    const liftType = LIFT_TYPE_LABEL[leg.lift_type] || "Lift";
    return name ? `${name} ${liftType.toLowerCase()} (down)` : `${liftType} (down)`;
  }
  if (leg.type === "skate") return "Skate across";
  if (leg.type === "walk")  return "Walk";
  const diff = DIFFICULTY_LABEL[leg.difficulty];
  if (name) return diff ? `${name} (${diff})` : name;
  return diff ? `${diff[0].toUpperCase()}${diff.slice(1)} piste` : "Piste";
}

function subFor(leg, graph) {
  // Short context line: start node → end node (compact)
  const a = graph.routingNodes[leg.startNodeId];
  const b = graph.routingNodes[leg.endNodeId];
  const aName = (a && a[3]) || "";
  const bName = (b && b[3]) || "";
  if (aName && bName) return `${aName} → ${bName}`;
  if (leg.type === "lift")     return "Lift up";
  if (leg.type === "lift_down")return "Lift down (penalty)";
  if (leg.type === "skate")    return "Connector";
  if (leg.type === "walk")     return "Foot traverse";
  return "";
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

  let html = `<div class="itin-list-summary">`
           + `<span>${legs.length} steps</span>`
           + `<span>${formatDist(totalDist)}</span>`
           + `<span class="down">↓ ${Math.round(totalDown)} m</span>`
           + `<span class="up">↑ ${Math.round(totalUp)} m</span>`
           + `</div>`;
  html += `<ol class="itin-list">`;
  legs.forEach((leg, i) => {
    const colour = pipColourFor(leg);
    const name = escapeHtml(nameFor(leg));
    const sub = escapeHtml(subFor(leg, graph));
    const gainCls = leg.elevDelta > 1 ? "up" : leg.elevDelta < -1 ? "down" : "";
    const gainText = formatElev(leg.elevDelta);
    html += `<li class="itin-step" data-step="${i}">`
          + `<div class="num mono">${String(i + 1).padStart(2, "0")}</div>`
          + `<div class="pip" style="background:${colour}"></div>`
          + `<div class="label"><div class="name">${name}</div>`
          +   (sub ? `<div class="sub">${sub}</div>` : "")
          + `</div>`
          + `<div class="dist mono">${formatDist(leg.distM)}</div>`
          + `<div class="gain mono ${gainCls}">${gainText}</div>`
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
