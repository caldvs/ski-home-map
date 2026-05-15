/**
 * Presentation helpers for the route-finder UI.
 *
 * Stateless leaf utilities pulled out of ui.js so that file can focus on
 * stateful flow (pin handling, drag-reroute, animation). Anything here
 * is pure — given a graph + edge + node-id, it returns a string or
 * number. No DOM lookups, no event handlers, no `window` access.
 *
 * Imported by ui.js and re-tested in isolation via the existing
 * front-end parity harness.
 */

// Difficulty colour palette. Black covers both `advanced` and `expert`
// because in OpenSkiData both are drawn as a black piste.
const DIFF_COLOURS_UI = {
  novice: "#00b050",
  easy: "#1e88e5",
  intermediate: "#e53935",
  advanced: "#2c2c2c",
  expert: "#2c2c2c",
  freeride: "#ff8800",
};


// Pin marker SVG. Teardrop-shaped pin pointing down — the tip is at SVG
// y=0 so MapLibre's anchor="bottom" lands the tip exactly at the geo
// point. Inner white disc holds a semantic icon:
//   A pin = start  → blue, "▶" play triangle
//   B pin = end    → black, 2×2 checkered finish flag
export function pinMarkerSVG(letter) {
  const isB = letter === "B";
  const fill = isB ? "#15130f" : "#2466ff";
  const icon = isB
    ? // Checkered finish flag — coloured top-left + bottom-right squares;
      // the white quadrants sit on the white inner disc.
      `<rect x="-4.5" y="-4.5" width="4.5" height="4.5" fill="${fill}"/>
       <rect x="0"    y="0"    width="4.5" height="4.5" fill="${fill}"/>`
    : // Right-pointing play triangle — start.
      `<path d="M -3,-4.5 L 5,0 L -3,4.5 Z" fill="${fill}"/>`;
  return `
    <svg class="pin-marker-svg" width="32" height="46" viewBox="-16 -44 32 46" aria-hidden="true">
      <ellipse cx="0" cy="1.5" rx="7" ry="2" fill="rgba(0,0,0,0.30)"/>
      <path
        d="M 0,0 C -2,-12 -14,-18 -14,-30 A 14,14 0 1 1 14,-30 C 14,-18 2,-12 0,0 Z"
        fill="${fill}" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="0" cy="-30" r="8.5" fill="#ffffff"/>
      <g transform="translate(0,-30)">${icon}</g>
    </svg>`;
}


export function formatSecs(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); const r = m % 60;
  return `${h}h${String(r).padStart(2, "0")}`;
}

export function formatDistM(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


export function describeNodeShort(graph, id) {
  const n = graph.routingNodes[id];
  const raw = (n && n[3]) || `node ${id}`;
  // Node names in the graph are like "Combe Folle bottom" or
  // "Tovière top" — the endpoint qualifier is data, not branding.
  // Strip "top" / "bottom" (with or without parens) at the end so the
  // Route Finder reads "Combe Folle" rather than "Combe Folle bottom".
  return raw.replace(/\s+\(?(top|bottom)\)?\s*$/i, "");
}


// Pick a "representative" edge for a node so the route-finder can show
// what the user has snapped to. Pin B's node may sit at the bottom of
// a piste AND at the bottom of a lift — we prefer to describe it as the
// piste, since that's almost always what the user clicked towards.
//
// Priority: run/connection touching this node → up-lift touching this
// node → lift-down. Up-lifts are preferred over lift-downs so the
// resulting featureIcon() direction calculation can assume edge.f =
// bottom, edge.t = top.
export function pickRepresentativeEdge(graph, nodeId) {
  const out = graph.adj[nodeId] || [];
  const inc = graph.reverseAdj[nodeId] || [];
  const all = [...out.map((i) => [i, true]), ...inc.map((i) => [i, false])];
  const byType = (types) => all.find(([i]) =>
    types.includes(graph.routingEdges[i].ty),
  );
  const piste = byType(["run", "connection"]);
  if (piste) return graph.routingEdges[piste[0]];
  const upLift = byType(["lift"]);
  if (upLift) return graph.routingEdges[upLift[0]];
  const downLift = byType(["lift_down"]);
  if (downLift) return graph.routingEdges[downLift[0]];
  return null;
}


// Tiny inline SVG that distinguishes piste vs lift in the route finder.
// Piste: filled triangle in the difficulty colour.
// Lift bottom (this node is the bottom station): up arrow.
// Lift top (this node is the top station):     down arrow.
//
// The lift/piste distinction matters because French resorts often name
// the piste and the lift identically, so just the name isn't enough.
//
// For ``lift`` edges, graph stores f=bottom, t=top. For ``lift_down``
// edges (the synthetic reverse used for ride-down routing) it's
// flipped: f=top, t=bottom. Normalise so isBottom means "this nodeId
// is the bottom station" regardless of which edge representation we
// picked.
export function featureIcon(edge, nodeId) {
  if (!edge) return "";
  const isLift = edge.ty === "lift" || edge.ty === "lift_down";
  if (isLift) {
    const isBottom = edge.ty === "lift"
      ? edge.f === nodeId
      : edge.t === nodeId;
    const up = `
      <svg class="feat-ic lift" viewBox="0 0 12 12" width="12" height="12" aria-label="lift bottom">
        <path d="M6 1.5 L6 10.5 M2.5 5 L6 1.5 L9.5 5"
          stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    const down = `
      <svg class="feat-ic lift" viewBox="0 0 12 12" width="12" height="12" aria-label="lift top">
        <path d="M6 1.5 L6 10.5 M2.5 7 L6 10.5 L9.5 7"
          stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    return isBottom ? up : down;
  }
  const colour = DIFF_COLOURS_UI[edge.d] || "#666";
  return `
    <svg class="feat-ic" viewBox="0 0 12 12" width="12" height="12" aria-label="piste">
      <path d="M1.5 2.5 L10.5 2.5 L6 10.5 Z" fill="${colour}" stroke="#fff" stroke-width="0.8"/>
    </svg>`;
}


// Roll up totals (distance, ascent, descent, lifts) for a route. Pure
// reduce over the path's edges + their attached geometry — handy for
// the summary chips in the route-finder.
export function summariseRoute(graph, path, totalSeconds) {
  let dist = 0, up = 0, down = 0;
  const lifts = new Set();
  for (const ei of path) {
    const e = graph.routingEdges[ei];
    const a = graph.routingNodes[e.f], b = graph.routingNodes[e.t];
    if (e.g && e.g.length >= 2) {
      for (let i = 1; i < e.g.length; i++) {
        dist += haversine(e.g[i - 1][0], e.g[i - 1][1], e.g[i][0], e.g[i][1]);
      }
    }
    const delta = b[2] - a[2];
    if (delta > 0) up += delta; else down -= delta;
    if (e.ty === "lift" && e.n) lifts.add(e.n);
  }
  return {
    distM: dist,
    upM: Math.round(up),
    downM: Math.round(down),
    timeSec: totalSeconds,
    lifts: lifts.size,
  };
}
