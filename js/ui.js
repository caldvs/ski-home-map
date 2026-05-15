/**
 * UI panel handlers — pin placement, route rendering, algorithm
 * visualisation animation, perf overlay. Operates on the modules
 * imported from routing.js + the live `map` + the loaded `graph`.
 */

import {
  runDijkstra, nearestNodeId, nearestPisteOrLiftNodeId,
  nearestPisteLineProjection, describeNode,
  DijkstraRunner, AstarRunner, BidirRunner, edgeCost,
  reachableCount,
} from "./routing.js?v=20260513";
import { renderElevationProfile, disposeElevationProfile } from "./elevation.js";
import { renderItinerary, disposeItinerary } from "./itinerary.js";
import { DIFF_COLOURS } from "./graph.js";

// Mirrors graph.js's DIFF_COLOURS — kept here so the route-finder UI can
// colour the piste icon without depending on the graph module's internal
// constants. Black covers both `advanced` and `expert` because in
// OpenSkiData both are drawn as a black piste.
const DIFF_COLOURS_UI = {
  novice: "#00b050",
  easy: "#1e88e5",
  intermediate: "#e53935",
  advanced: "#2c2c2c",
  expert: "#2c2c2c",
  freeride: "#ff8800",
};

// ── Pin marker SVG: "node + chip" variant from the design canvas.
// Ground node + dashed halo, with a small chip floating above on a
// downward-stem pentagon (accent for A, near-black for B).
function pinMarkerSVG(letter) {
  const isB = letter === "B";
  const fill = isB ? "#15130f" : "#2466ff";
  return `
    <svg class="pin-marker-svg" width="28" height="40" viewBox="-14 -32 28 40" aria-hidden="true">
      <ellipse cx="0" cy="2" rx="9" ry="2.6" fill="#000" opacity="0.22"/>
      <circle cx="0" cy="0" r="11.5" fill="none" stroke="${fill}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="2 2"/>
      <circle cx="0" cy="0" r="6" fill="${fill}" stroke="#fff" stroke-width="2"/>
      <g transform="translate(-7, -26)">
        <path d="M 0 0 L 14 0 L 14 12 L 9 12 L 7 16 L 5 12 L 0 12 Z" fill="${fill}"/>
        <text x="7" y="9.5" font-size="9.5" font-weight="700" fill="#fff" text-anchor="middle"
          font-family="Geist, sans-serif">${letter}</text>
      </g>
    </svg>`;
}

function formatSecs(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); const r = m % 60;
  return `${h}h${String(r).padStart(2, "0")}`;
}
function formatDistM(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function describeNodeShort(graph, id) {
  const n = graph.routingNodes[id];
  const raw = n[3] || `node ${id}`;
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
// Priority: run/connection touching this node → lift touching this node
// → fall back to anything.
function pickRepresentativeEdge(graph, nodeId) {
  const out = graph.adj[nodeId] || [];
  const inc = graph.reverseAdj[nodeId] || [];
  const all = [...out.map((i) => [i, true]), ...inc.map((i) => [i, false])];
  const byType = (types) => all.find(([i]) =>
    types.includes(graph.routingEdges[i].ty),
  );
  const piste = byType(["run", "connection"]);
  if (piste) return graph.routingEdges[piste[0]];
  const lift = byType(["lift", "lift_down"]);
  if (lift) return graph.routingEdges[lift[0]];
  return null;
}

// Tiny inline SVG that distinguishes piste vs lift in the route finder.
// Piste: filled triangle in the difficulty colour.
// Lift bottom (this node is e.f, lift goes up from here): up arrow.
// Lift top (this node is e.t, lift terminates here): down arrow.
// The lift/piste distinction matters because French resorts often name
// the piste and the lift identically, so just the name isn't enough.
function featureIcon(edge, nodeId) {
  if (!edge) return "";
  const isLift = edge.ty === "lift" || edge.ty === "lift_down";
  if (isLift) {
    const isBottom = edge.f === nodeId;  // standing where the lift starts
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

function summariseRoute(graph, path, totalSeconds) {
  let dist = 0, up = 0, down = 0, lifts = new Set();
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

function setEmptyUI() {
  // Collapse the panel back to its compact "no route" size.
  document.body.classList.remove("has-route");
  if (typeof window._skihomeMap !== "undefined") setRouteDimming(window._skihomeMap, false);
  const info = document.getElementById("user-route-info");
  info.innerHTML =
    `<div class="ab-status"><span class="empty">Click the map to place pin A.</span></div>`;
  const chips = document.getElementById("route-summary-chips");
  chips.hidden = true;
  chips.innerHTML = "";
  // Tab badges
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText("tab-count-itin", "—");
  setText("tab-count-elev", "—");
  setText("tab-count-alt",  "—");
  // Tab content empty messages
  const itinEmpty = document.getElementById("itin-empty");
  const elevEmpty = document.getElementById("elev-empty");
  if (itinEmpty) itinEmpty.hidden = false;
  if (elevEmpty) elevEmpty.hidden = false;
}

// Original opacity values per layer — used to restore when the route is
// cleared (setPaintProperty overwrites the source style).
const PISTE_LIFT_LAYER_RESTORE = {
  "pistes-outline": { prop: "line-opacity",   value: ["interpolate", ["linear"], ["zoom"], 5, 0, 18, 1] },
  "pistes-layer":   { prop: "line-opacity",   value: ["interpolate", ["linear"], ["zoom"], 5, 0, 18, 1] },
  "lifts-casing":   { prop: "line-opacity",   value: ["interpolate", ["linear"], ["zoom"], 5, 0, 18, 1] },
  "lifts-layer":    { prop: "line-opacity",   value: 0.8 },
  "skates-layer":   { prop: "line-opacity",   value: 0.5 },
  "piste-labels":   { prop: "text-opacity",   value: 1.0 },
  "lift-labels":    { prop: "text-opacity",   value: 1.0 },
  "stations-layer": { prop: "circle-opacity", value: 1.0 },
};

// Non-route opacity multiplier. 0.8 ≈ "dim by 20%" — colours stay recognisable
// while the route line and labels in the route stand out clearly.
const NON_ROUTE_OPACITY = 0.8;

// Build a "case" expression that keeps route members at their normal opacity
// and applies the dim multiplier to everything else, by matching on feature
// name. (Pistes/lifts source features don't have stable feature.ids, so we
// match on the `name` property which is set in graph.js.)
function dimmedExpr(restoreValue, routeNames, multiplier) {
  const dimmed =
    typeof restoreValue === "number"
      ? restoreValue * multiplier
      : ["*", restoreValue, multiplier];
  if (!routeNames || routeNames.length === 0) return dimmed;
  return [
    "case",
    ["in", ["get", "name"], ["literal", routeNames]],
    restoreValue,
    dimmed,
  ];
}

// Layer → which set of route names to preserve at full opacity.
const LAYER_ROUTE_KEY = {
  "pistes-outline": "pistes",
  "pistes-layer":   "pistes",
  "lifts-casing":   "lifts",
  "lifts-layer":    "lifts",
  "skates-layer":   null,         // skates are never part of a route — always dim
  "piste-labels":   "pistes",
  "lift-labels":    "lifts",
  "stations-layer": null,         // station dots: dim uniformly (no name link)
};

function setRouteDimming(map, dimmed) {
  const members = (dimmed && window._routeMembers) || { pistes: [], lifts: [] };
  for (const [id, { prop, value: restoreValue }] of Object.entries(PISTE_LIFT_LAYER_RESTORE)) {
    if (!map.getLayer(id)) continue;
    if (!dimmed) {
      map.setPaintProperty(id, prop, restoreValue);
      continue;
    }
    const key = LAYER_ROUTE_KEY[id];
    const routeNames = key ? (members[key] || []) : [];
    map.setPaintProperty(id, prop, dimmedExpr(restoreValue, routeNames, NON_ROUTE_OPACITY));
  }
}

// Build a JSON-serialisable snapshot of the current route for debugging.
// Captures pin lat/lng, mode, total time, and a flat list of legs with the
// fields most useful for sanity-checking ("why did it pick this lift / piste?").
function buildRouteSnapshot(graph, startId, endId, mode, result, startPin, endPin,
                            approachGeom, startEdge, endEdge) {
  const ll = (m) => {
    if (!m) return null;
    try {
      const x = m.getLngLat ? m.getLngLat() : m._lngLat || m;
      return { lat: +x.lat.toFixed(6), lng: +x.lng.toFixed(6) };
    } catch { return null; }
  };
  const nodeName = (id) => {
    if (id == null) return null;
    const n = graph.routingNodes[id];
    return n && n.name ? n.name : null;
  };
  const legs = (result.path || []).map((eIdx) => {
    const e = graph.routingEdges[eIdx];
    if (!e) return { edgeIdx: eIdx, ok: false };
    return {
      edgeIdx: eIdx,
      type: e.ty,              // run | lift | lift_down | skate | connection | walk
      name: e.n || null,
      from: e.f,
      to: e.t,
      fromName: nodeName(e.f),
      toName: nodeName(e.t),
      difficulty: e.d ?? null, // piste difficulty colour code
      liftType: e.lt ?? null,  // chairlift / gondola / etc.
      costSeconds: e.c ?? null,
      // Two-point summary of the geometry — full line omitted to keep payload light.
      first: e.g && e.g[0] ? [e.g[0][0], e.g[0][1]] : null,
      last:  e.g && e.g[e.g.length-1] ? [e.g[e.g.length-1][0], e.g[e.g.length-1][1]] : null,
      pointCount: e.g ? e.g.length : 0,
    };
  });
  // Roll up a small per-leg summary for "what's in this route" at a glance.
  const summary = {
    totalSeconds: result.totalSeconds ?? null,
    legCount:    legs.length,
    runLegs:     legs.filter(l => l.type === "run").length,
    liftLegs:    legs.filter(l => l.type === "lift").length,
    liftDownLegs: legs.filter(l => l.type === "lift_down").length,
    skateLegs:   legs.filter(l => l.type === "skate").length,
    connectionLegs: legs.filter(l => l.type === "connection").length,
  };
  return {
    capturedAt: new Date().toISOString(),
    resort: (typeof window._currentWorldName === "string") ? window._currentWorldName : null,
    mode,
    pinA: { ...ll(startPin), nodeId: startId, nodeName: nodeName(startId),
            startEdgeIdx: startEdge ?? null,
            approachGeom: approachGeom || null },
    pinB: { ...ll(endPin), nodeId: endId, nodeName: nodeName(endId),
            endEdgeIdx: endEdge ?? null },
    summary,
    legs,
  };
}

function setRouteUI(graph, startId, endId, result, startEdge, endEdge) {
  // Flag the body so the left panel can expand from its compact "no route"
  // size to full height (CSS transitions max-height).
  document.body.classList.add("has-route");
  // Dim non-route pistes / lifts so the yellow route line dominates.
  if (typeof window._skihomeMap !== "undefined") setRouteDimming(window._skihomeMap, true);
  const summary = summariseRoute(graph, result.path, result.totalSeconds);

  // A→B status line
  const info = document.getElementById("user-route-info");
  info.innerHTML = `
    <div class="ab-status">
      <span class="pin-dot">A</span>
      ${featureIcon(startEdge, startId)}
      <span>${describeNodeShort(graph, startId)}</span>
      <span class="arrow">→</span>
      <span class="pin-dot b">B</span>
      ${featureIcon(endEdge, endId)}
      <span>${describeNodeShort(graph, endId)}</span>
    </div>`;

  // Summary chips
  const chips = document.getElementById("route-summary-chips");
  chips.innerHTML = `
    <span class="s"><span class="k">DIST</span>${formatDistM(summary.distM)}</span>
    <span class="s"><span class="k">UP</span>+${summary.upM} m</span>
    <span class="s"><span class="k">DOWN</span>−${summary.downM} m</span>
    <span class="s"><span class="k">TIME</span>${formatSecs(summary.timeSec)}</span>
    <span class="s"><span class="k">LIFTS</span>${summary.lifts}</span>`;
  chips.hidden = false;

  // Tab badges
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText("tab-count-itin", String(result.path.length));
  setText("tab-count-elev", `+${summary.upM}`);
  setText("tab-count-alt",  "—");

  // Hide empty messages
  const itinEmpty = document.getElementById("itin-empty");
  const elevEmpty = document.getElementById("elev-empty");
  if (itinEmpty) itinEmpty.hidden = true;
  if (elevEmpty) elevEmpty.hidden = true;

  // Auto-switch to Itinerary tab
  if (typeof window.activateRouteTab === "function") window.activateRouteTab("itin");
}

function setNoRouteUI(graph, startId, endId, fwd, rev, threshold, total, startEdge, endEdge) {
  const info = document.getElementById("user-route-info");
  let why;
  if (fwd <= threshold && rev > threshold) {
    why = `Start is stuck in a ${fwd}-node pocket — the graph has no skiable route out of here.`;
  } else if (rev <= threshold && fwd > threshold) {
    why = `End is in a ${rev}-node pocket — nothing in the wider graph can ski into it.`;
  } else if (fwd <= threshold && rev <= threshold) {
    why = `Both endpoints are in small pockets (start ${fwd}, end ${rev}) — probable graph gap.`;
  } else {
    why = `No route found between these specific points — likely a missing one-way edge.`;
  }
  info.innerHTML = `
    <div class="ab-status">
      <span class="pin-dot">A</span>
      ${featureIcon(startEdge, startId)}
      <span>${describeNodeShort(graph, startId)}</span>
      <span class="arrow">→</span>
      <span class="pin-dot b">B</span>
      ${featureIcon(endEdge, endId)}
      <span>${describeNodeShort(graph, endId)}</span>
    </div>
    <div style="margin-top:6px;font-size:11.5px;color:var(--accent);font-family:Geist,sans-serif">${why}</div>`;
}

export function wireRouting(map, graph) {
  let startPin = null, endPin = null;
  let startNodeId = null, endNodeId = null;
  // Representative edges for each pin's snapped node — drives the small
  // piste/lift icon shown next to each pin's name in the route finder.
  let startEdge = null, endEdge = null;
  // Optional "via" forced through the route — set by clicking on a piste
  // segment of the rendered route. Clears when route is cleared.
  let viaNodeId = null;
  let viaPin = null;
  let itinHoverMarker = null;

  function setItinSelect(leg) {
    if (!leg || !Array.isArray(leg.edges)) return;
    let minLat =  Infinity, maxLat = -Infinity;
    let minLon =  Infinity, maxLon = -Infinity;
    for (const ei of leg.edges) {
      const e = graph.routingEdges[ei];
      if (!e || !e.g) continue;
      for (const c of e.g) {
        // c is [lat, lon] (routing edge storage)
        if (c[0] < minLat) minLat = c[0];
        if (c[0] > maxLat) maxLat = c[0];
        if (c[1] < minLon) minLon = c[1];
        if (c[1] > maxLon) maxLon = c[1];
      }
    }
    if (minLat === Infinity) return;
    // Frame the leg with some breathing room; clamp zoom so very
    // short skating links don't shoot us to z19.
    map.fitBounds(
      [[minLon, minLat], [maxLon, maxLat]],
      { padding: 60, duration: 700, maxZoom: 16.5 },
    );
  }

  function setItinHover(leg, lat, lon) {
    const highlightSrc = map.getSource("route-leg-highlight");
    if (!leg) {
      if (itinHoverMarker) { itinHoverMarker.remove(); itinHoverMarker = null; }
      if (highlightSrc) highlightSrc.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    if (!itinHoverMarker) {
      const el = document.createElement("div");
      el.className = "itin-hover-marker";
      itinHoverMarker = new maplibregl.Marker({ element: el })
        .setLngLat([lon, lat]).addTo(map);
    } else {
      itinHoverMarker.setLngLat([lon, lat]);
    }
    // Build the merged geometry from all edges that make up this leg and
    // push it to the highlight source. The line sits on top of the
    // route-yellow line, so the segment glows against the rest.
    if (highlightSrc && Array.isArray(leg.edges)) {
      const coords = [];
      for (const ei of leg.edges) {
        const e = graph.routingEdges[ei];
        if (!e || !e.g) continue;
        for (const c of e.g) {
          const lonLat = [c[1], c[0]];
          if (coords.length &&
              coords[coords.length - 1][0] === lonLat[0] &&
              coords[coords.length - 1][1] === lonLat[1]) continue;
          coords.push(lonLat);
        }
      }
      if (coords.length >= 2) {
        highlightSrc.setData({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords },
            properties: {},
          }],
        });
      }
    }
  }

  // Pin A's display coords — may differ from the graph node A actually
  // routes from (if the user clicked off-piste, the pin sits wherever
  // clicked and a dashed "approach" line connects the pin to the
  // nearest graph node).
  let startDisplay = null;  // { lat, lon }

  // Pin-A's display location and routing node may differ. The dashed
  // approach line bridges them. forceNid lets the caller pass the node
  // explicitly when startNodeId hasn't been written yet (placePin runs
  // before handlePinClick assigns the global).
  // Draw the dashed approach line. We bridge from the click location
  // (startDisplay) straight to startEntry — the perpendicular foot on
  // the nearest piste/lift. That's the actual "you ski straight onto
  // the piste here" visualisation. The route itself then continues
  // from the matching graph node.
  function setStartApproach() {
    const src = map.getSource("start-approach");
    if (!src) return;
    if (!startDisplay || !startEntry) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const dLon = Math.abs(startEntry.lon - startDisplay.lon);
    const dLat = Math.abs(startEntry.lat - startDisplay.lat);
    if (dLon < 1e-6 && dLat < 1e-6) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    src.setData({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [startDisplay.lon, startDisplay.lat],
            [startEntry.lon,   startEntry.lat],
          ],
        },
        properties: {},
      }],
    });
  }

  // Build a pin marker. kind = "start" → free-form, displayed at
  // (displayLat, displayLon). kind = "end" → snapped to a piste/lift
  // node, displayed at that node's coordinates.
  // Pin A's projected entry point onto a piste (perpendicular foot
  // along the nearest piste/lift line). Used to draw the dashed
  // approach line from the free-form pin to the actual on-piste
  // entry, NOT to the nearest fork/join.
  let startEntry = null;  // { lat, lon } — perpendicular foot on the nearest piste
  let startApproachGeom = null;  // [[lat, lon], ...] from startEntry to startNodeId

  function placePin(lat, lon, kind) {
    if (kind === "start") {
      // Pin A is free-form: the visible marker sits where the user
      // clicked. We project that click onto the nearest piste / lift
      // line (perpendicular foot), use that projection as the visual
      // "entry point" on the piste, and use the edge's nearer
      // endpoint as the routing source.
      const proj = nearestPisteLineProjection(graph, lat, lon);
      if (!proj) return null;
      startDisplay = { lat, lon };
      startEntry = { lat: proj.projLat, lon: proj.projLon };
      startApproachGeom = proj.approachGeom;
      startEdge = graph.routingEdges[proj.edgeIdx] || null;
      const r = buildMarker(lat, lon, kind, proj.nodeId);
      setStartApproach();
      return r;
    }
    // Pin B: visibly snaps to the nearest piste / lift node.
    const nid = nearestPisteOrLiftNodeId(graph, lat, lon);
    if (nid === null) return null;
    const n = graph.routingNodes[nid];
    endEdge = pickRepresentativeEdge(graph, nid);
    return buildMarker(n[1], n[0], kind, nid);
  }

  function buildMarker(lat, lon, kind, nid) {
    const el = document.createElement("div");
    el.innerHTML = pinMarkerSVG(kind === "end" ? "B" : "A");
    el.style.cursor = "grab";
    const popup = new maplibregl.Popup({ offset: 22 }).setText(describeNode(graph, nid));
    const marker = new maplibregl.Marker({
      element: el,
      anchor: "bottom",
      draggable: true,
    })
      .setLngLat([lon, lat])
      .setPopup(popup)
      .addTo(map);

    marker.on("dragstart", () => {
      el.style.cursor = "grabbing";
      popup.remove();
    });
    marker.on("dragend", () => {
      el.style.cursor = "grab";
      const ll = marker.getLngLat();
      const point = map.project(ll);
      const { lat: nlat, lon: nlon } = pickCoordAtPoint(point, ll);

      let newNid;
      if (kind === "start") {
        const proj = nearestPisteLineProjection(graph, nlat, nlon);
        if (!proj) { marker.setLngLat([lon, lat]); return; }
        newNid = proj.nodeId;
        marker.setLngLat([nlon, nlat]);
        startDisplay = { lat: nlat, lon: nlon };
        startEntry   = { lat: proj.projLat, lon: proj.projLon };
        startApproachGeom = proj.approachGeom;
        startNodeId = newNid;
        startEdge = graph.routingEdges[proj.edgeIdx] || null;
        popup.setText(describeNode(graph, newNid));
        setStartApproach();
      } else {
        // Pin B: snap visibly to the nearest piste/lift node.
        newNid = nearestPisteOrLiftNodeId(graph, nlat, nlon);
        if (newNid === null) { marker.setLngLat([lon, lat]); return; }
        const newN = graph.routingNodes[newNid];
        marker.setLngLat([newN[0], newN[1]]);
        popup.setText(describeNode(graph, newNid));
        endNodeId = newNid;
        endEdge = pickRepresentativeEdge(graph, newNid);
      }
      if (startNodeId !== null && endNodeId !== null) recomputeRoute();
    });

    return { marker, nodeId: nid };
  }

  function clearUserRoute() {
    if (startPin) { startPin.remove(); startPin = null; }
    if (endPin) { endPin.remove(); endPin = null; }
    if (viaPin) { viaPin.remove(); viaPin = null; }
    viaNodeId = null;
    startNodeId = null; endNodeId = null;
    startEdge = null; endEdge = null;
    startDisplay = null;
    startEntry = null;
    startApproachGeom = null;
    if (map.getSource("start-approach")) {
      map.getSource("start-approach").setData({ type: "FeatureCollection", features: [] });
    }
    if (map.getSource("user-route")) {
      map.getSource("user-route").setData({ type: "FeatureCollection", features: [] });
    }
    if (map.getSource("user-route-transitions")) {
      map.getSource("user-route-transitions").setData({ type: "FeatureCollection", features: [] });
    }
    if (map.getSource("anim-settled")) {
      map.getSource("anim-settled").setData({ type: "FeatureCollection", features: [] });
    }
    if (map.getSource("route-leg-highlight")) {
      map.getSource("route-leg-highlight").setData({ type: "FeatureCollection", features: [] });
    }
    stopAnimation();
    disposeElevationProfile(document.getElementById("elevation-profile"));
    disposeItinerary(document.getElementById("itinerary"));
    if (itinHoverMarker) { itinHoverMarker.remove(); itinHoverMarker = null; }
    setEmptyUI();
    const statsEl = document.getElementById("anim-stats");
    if (statsEl) statsEl.innerHTML = "Drop two pins, then press Animate to watch the search expand.";
  }

  // Point-feature snap layers — clicking near a village dot / station
  // dot / lift label snaps to that exact feature's coordinate so the
  // pin lands cleanly on the named thing.
  const POINT_SNAP_LAYERS = [
    "villages-layer", "villages-label",
    "stations-layer", "lift-labels",
  ];

  function pickCoordAtPoint(point, fallbackLngLat) {
    const ptLayers = POINT_SNAP_LAYERS.filter((id) => map.getLayer(id));
    if (ptLayers.length) {
      const r = 8;
      const feats = map.queryRenderedFeatures(
        [[point.x - r, point.y - r], [point.x + r, point.y + r]],
        { layers: ptLayers },
      );
      if (feats.length) {
        const c = feats[0].geometry && feats[0].geometry.coordinates;
        if (c && c.length >= 2) return { lat: c[1], lon: c[0] };
      }
    }
    const ll = fallbackLngLat || map.unproject(point);
    return { lat: ll.lat, lon: ll.lng };
  }

  function pickClickCoord(ev) {
    return pickCoordAtPoint(ev.point, ev.lngLat);
  }

  // Run Dijkstra for the current startNodeId / endNodeId and update
  // every piece of route UI (line, summary chips, elevation profile,
  // itinerary, anim stats). Used after a pin drag too.
  function recomputeRoute() {
    if (startNodeId === null || endNodeId === null) return;
    const mode = document.getElementById("user-difficulty").value;
    const t0 = performance.now();
    // Forced-via support: split into two Dijkstras (A→via and via→B) and
    // concatenate. Falls back to direct routing if either half is unreachable.
    let result;
    if (viaNodeId != null && viaNodeId !== startNodeId && viaNodeId !== endNodeId) {
      const r1 = runDijkstra(startNodeId, viaNodeId, mode, graph);
      const r2 = runDijkstra(viaNodeId, endNodeId, mode, graph);
      if (r1.path && r2.path) {
        result = {
          path: r1.path.concat(r2.path),
          totalSeconds: (r1.totalSeconds || 0) + (r2.totalSeconds || 0),
          visited: (r1.visited || 0) + (r2.visited || 0),
        };
      } else {
        // Either half blocked — drop via and try direct.
        if (viaPin) { viaPin.remove(); viaPin = null; }
        viaNodeId = null;
        result = runDijkstra(startNodeId, endNodeId, mode, graph);
      }
    } else {
      result = runDijkstra(startNodeId, endNodeId, mode, graph);
    }
    const tMs = (performance.now() - t0).toFixed(0);
    if (result.path === null) {
      const POCKET_THRESHOLD = 25;
      const PROBE = POCKET_THRESHOLD + 1;
      const totalNodes = graph.routingNodes.length;
      const fwd = reachableCount(graph, startNodeId, { limit: PROBE });
      const rev = reachableCount(graph, endNodeId,   { limit: PROBE, reverse: true });
      setNoRouteUI(graph, startNodeId, endNodeId, fwd, rev, POCKET_THRESHOLD, totalNodes, startEdge, endEdge);
      if (map.getSource("user-route")) {
        map.getSource("user-route").setData({ type: "FeatureCollection", features: [] });
      }
      if (map.getSource("user-route-transitions")) {
        map.getSource("user-route-transitions").setData({ type: "FeatureCollection", features: [] });
      }
      disposeElevationProfile(document.getElementById("elevation-profile"));
      disposeItinerary(document.getElementById("itinerary"));
      return;
    }
    drawRoute(map, graph, result.path, startApproachGeom);
    // Stash a serialisable snapshot of the route for the Copy-data button.
    // Includes pin lat/lng, mode, edge-level legs with type/name/elev/length —
    // enough to debug "why did it suggest this routing".
    window._lastRouteData = buildRouteSnapshot(
      graph, startNodeId, endNodeId, mode, result,
      startPin, endPin, startApproachGeom, startEdge, endEdge,
    );
    setRouteUI(graph, startNodeId, endNodeId, result, startEdge, endEdge);
    renderElevationProfile(
      document.getElementById("elevation-profile"), map, graph, result.path,
    );
    renderItinerary(
      document.getElementById("itinerary"), graph, result.path,
      { onHover: setItinHover, onSelect: setItinSelect },
    );
    const statsEl = document.getElementById("anim-stats");
    if (statsEl) {
      statsEl.innerHTML =
        `Dijkstra visited <b>${result.visited}</b> nodes in ${tMs} ms · ` +
        `path <b>${result.path.length}</b> edges`;
    }
  }

  function handlePinClick({ lat, lon }) {
    const mode = document.getElementById("user-difficulty").value;

    if (startPin === null) {
      const r = placePin(lat, lon, "start");
      if (!r) return;
      startPin = r.marker; startNodeId = r.nodeId;
      const info = document.getElementById("user-route-info");
      info.innerHTML = `
        <div class="ab-status">
          <span class="pin-dot">A</span>
          ${featureIcon(startEdge, r.nodeId)}
          <span>${describeNodeShort(graph, r.nodeId)}</span>
          <span class="arrow">→</span>
          <span class="empty">Click again to place pin B.</span>
        </div>`;
      return;
    }
    if (endPin === null) {
      const r = placePin(lat, lon, "end");
      if (!r) return;
      endPin = r.marker; endNodeId = r.nodeId;
      recomputeRoute();
      return;
    }
    // 3rd click → reset and start over
    clearUserRoute();
    const r3 = placePin(lat, lon, "start");
    if (!r3) return;
    startPin = r3.marker; startNodeId = r3.nodeId;
    const info3 = document.getElementById("user-route-info");
    info3.innerHTML = `
      <div class="ab-status">
        <span class="pin-dot">A</span>
        ${featureIcon(startEdge, r3.nodeId)}
        <span>${describeNodeShort(graph, r3.nodeId)}</span>
        <span class="arrow">→</span>
        <span class="empty">Click again to place pin B.</span>
      </div>`;
  }
  // Clicking on a piste segment of the rendered route forces the route to
  // pass through that point (snapped to the nearest piste/lift graph node).
  // Set before the general click handler so we can swallow the event.
  let _routeClickedThisTick = false;
  map.on("click", "user-route-piste-base", (ev) => {
    if (startNodeId == null || endNodeId == null) return;
    const ll = ev.lngLat;
    const nid = nearestPisteOrLiftNodeId(graph, ll.lat, ll.lng);
    if (nid == null || nid === startNodeId || nid === endNodeId) return;
    viaNodeId = nid;
    if (viaPin) viaPin.remove();
    const n = graph.routingNodes[viaNodeId];
    if (n) {
      const el = document.createElement("div");
      el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#8b5cf6;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.25);cursor:pointer;";
      el.title = "Forced waypoint — click to clear";
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        viaNodeId = null;
        if (viaPin) { viaPin.remove(); viaPin = null; }
        recomputeRoute();
      });
      viaPin = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([n[0], n[1]])
        .addTo(map);
    }
    _routeClickedThisTick = true;
    setTimeout(() => { _routeClickedThisTick = false; }, 0);
    recomputeRoute();
  });
  // Cursor affordance when hovering the route's piste segments.
  map.on("mouseenter", "user-route-piste-base", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "user-route-piste-base", () => { map.getCanvas().style.cursor = ""; });

  map.on("click", (ev) => {
    if (_routeClickedThisTick) return;
    handlePinClick(pickClickCoord(ev));
  });

  for (const layerId of POINT_SNAP_LAYERS) {
    map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
  }

  // Clear / Copy buttons (visible only when body.has-route).
  const clearBtn = document.getElementById("clear-route-btn");
  if (clearBtn) clearBtn.addEventListener("click", clearUserRoute);
  const copyBtn  = document.getElementById("copy-route-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const snapshot = window._lastRouteData;
      if (!snapshot) return;
      const json = JSON.stringify(snapshot, null, 2);
      try {
        await navigator.clipboard.writeText(json);
        copyBtn.textContent = "Copied ✓";
        copyBtn.classList.add("copied");
      } catch (e) {
        // Clipboard API may fail (insecure context etc) — fall back to a textarea hack.
        const ta = document.createElement("textarea");
        ta.value = json;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); copyBtn.textContent = "Copied ✓"; copyBtn.classList.add("copied"); }
        catch { copyBtn.textContent = "Copy failed"; }
        document.body.removeChild(ta);
      }
      setTimeout(() => {
        copyBtn.textContent = "Copy data";
        copyBtn.classList.remove("copied");
      }, 1500);
    });
  }

  // Recompute the live route whenever the user switches difficulty mode.
  const diffSelect = document.getElementById("user-difficulty");
  if (diffSelect) {
    diffSelect.addEventListener("change", () => {
      if (startNodeId !== null && endNodeId !== null) recomputeRoute();
    });
  }

  // ───── Algorithm animation with hero overlay ─────

  let animTimer = null;
  let animFeatures = [];

  const heroEl     = document.getElementById("algo-hero");
  const heroLead   = document.getElementById("algo-hero-lead");
  const heroSub    = document.getElementById("algo-hero-sub");
  const heroNode   = document.getElementById("algo-hero-node");
  const heroFront  = document.getElementById("algo-hero-frontier");
  const heroVisit  = document.getElementById("algo-hero-visited");
  const heroCost   = document.getElementById("algo-hero-cost");
  const heroFill   = document.getElementById("algo-hero-fill");
  const heroSpeed  = document.getElementById("algo-hero-speed");
  const heroStrip  = document.getElementById("algo-hero-strip");
  const heroPause  = document.getElementById("algo-hero-pause");

  // Build the frontier strip cells once
  if (heroStrip && heroStrip.children.length === 0) {
    for (let i = 0; i < 28; i++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      heroStrip.appendChild(cell);
    }
  }

  let heroAlgoName = "Dijkstra";
  let heroAlgoHeuristic = "uniform cost";
  let heroPaused = false;
  let heroPendingResume = null;

  function showHero(algorithm, speedNps) {
    heroAlgoName = algorithm === "astar" ? "A*"
                 : algorithm === "bidir" ? "Bidirectional Dijkstra"
                 : "Dijkstra";
    heroAlgoHeuristic = algorithm === "astar" ? "Euclidean heuristic"
                      : algorithm === "bidir" ? "two-ended search"
                      : "uniform cost · radial expansion";
    heroSub.textContent = `${heroAlgoName} · ${heroAlgoHeuristic}`;
    heroSpeed.textContent = `×${(speedNps / 200).toFixed(speedNps < 500 ? 2 : 1)}`;
    heroPaused = false;
    heroPause.textContent = "⏸ Pause";
    heroEl.hidden = false;
  }
  function hideHero() {
    heroEl.hidden = true;
    heroPaused = false;
  }
  function updateHero({ iters, frontier, cost, settled, total, paths }) {
    heroNode.textContent = `node ${iters} / ${total}`;
    heroFront.textContent = String(frontier);
    heroVisit.textContent = String(iters);
    heroCost.textContent  = (cost != null) ? Math.round(cost).toLocaleString() : "—";
    const pct = total ? Math.min(100, (iters / total) * 100) : 0;
    heroFill.style.width = pct + "%";

    // Frontier strip: fill cells proportionally
    const cells = heroStrip.children;
    const visitedCells = Math.floor((pct / 100) * cells.length);
    const frontierCells = Math.min(cells.length - visitedCells, Math.max(1, Math.floor(frontier / 4)));
    for (let i = 0; i < cells.length; i++) {
      cells[i].className = "cell"
        + (i < visitedCells ? " visited"
        : i < visitedCells + frontierCells ? " frontier"
        : (paths && i === cells.length - 1) ? " path"
        : "");
    }
  }

  function stopAnimation() {
    if (animTimer !== null) { cancelAnimationFrame(animTimer); animTimer = null; }
    animFeatures = [];
    if (map.getSource("anim-settled")) {
      map.getSource("anim-settled").setData({ type: "FeatureCollection", features: [] });
    }
    hideHero();
  }
  window.stopAnimation = stopAnimation;

  function runAnimation(algorithm, src, tgt, mode, nodesPerSec) {
    stopAnimation();
    let runner;
    if (algorithm === "astar") runner = new AstarRunner(src, tgt, mode, graph);
    else if (algorithm === "bidir") runner = new BidirRunner(src, tgt, mode, graph);
    else runner = new DijkstraRunner(src, tgt, mode, graph);

    const statsEl = document.getElementById("anim-stats");
    const totalNodes = graph.routingNodes.length;
    showHero(algorithm, nodesPerSec);

    const t0 = performance.now();
    let lastTick = t0;
    let lastFrontierSize = 0;

    function tick(now) {
      if (heroPaused) { animTimer = requestAnimationFrame(tick); return; }
      const elapsedMs = now - lastTick;
      const steps = Math.max(1, Math.floor((elapsedMs * nodesPerSec) / 1000));
      for (let i = 0; i < steps; i++) {
        const r = runner.step();
        if (r === null) break;
        if (r.settled !== -1) {
          const n = graph.routingNodes[r.settled];
          if (n) {
            animFeatures.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [n[0], n[1]] },
              properties: { dir: r.direction, meeting: r.meeting },
            });
          }
        }
      }
      lastTick = now;
      map.getSource("anim-settled").setData({
        type: "FeatureCollection", features: animFeatures,
      });

      // Frontier size estimate: heap len if available, else delta of iters
      let frontier = 0;
      try { frontier = (runner.heap && runner.heap.length) || (runner.iters - lastFrontierSize); } catch (e) {}
      lastFrontierSize = runner.iters;

      updateHero({
        iters: runner.iters,
        frontier: Math.max(1, frontier),
        cost: runner.bestCost || null,
        total: totalNodes,
      });

      const elapsed = ((now - t0) / 1000).toFixed(1);
      if (statsEl) statsEl.innerHTML = `${heroAlgoName} — ${runner.iters} nodes · ${elapsed}s`;

      if (runner.done) {
        if (runner.foundPath && runner.foundPath.length) {
          drawRoute(map, graph, runner.foundPath, startApproachGeom);
          renderElevationProfile(
            document.getElementById("elevation-profile"),
            map, graph, runner.foundPath,
          );
          renderItinerary(
            document.getElementById("itinerary"), graph, runner.foundPath,
            { onHover: setItinHover, onSelect: setItinSelect },
          );
          let totalSec = 0;
          runner.foundPath.forEach((eIdx) => {
            totalSec += edgeCost(graph.routingEdges[eIdx], mode);
          });
          // Populate top-bar summary too
          setRouteUI(graph, src, tgt, {
            path: runner.foundPath,
            totalSeconds: totalSec,
            visited: runner.iters,
          });
          if (statsEl) {
            statsEl.innerHTML =
              `<b>${heroAlgoName}</b> · ${runner.iters} nodes settled · ` +
              `path ${runner.foundPath.length} edges · ${Math.round(totalSec / 60)} min · wall ${elapsed}s`;
          }
        } else {
          if (statsEl) statsEl.innerHTML = `<b style="color:var(--accent)">${heroAlgoName}: no route</b>`;
        }
        animTimer = null;
        setTimeout(hideHero, 1200); // dwell a moment so the user sees the final state
        return;
      }
      animTimer = requestAnimationFrame(tick);
    }
    animTimer = requestAnimationFrame(tick);
  }

  heroPause.addEventListener("click", () => {
    heroPaused = !heroPaused;
    heroPause.textContent = heroPaused ? "▶ Resume" : "⏸ Pause";
  });

  const speedEl = document.getElementById("anim-speed");
  if (speedEl) {
    speedEl.addEventListener("input", (e) => {
      document.getElementById("anim-speed-label").textContent = e.target.value;
    });
  }
  document.getElementById("anim-run-btn").addEventListener("click", () => {
    if (startNodeId === null || endNodeId === null) {
      alert("Drop two pins on the map first.");
      return;
    }
    const algorithm = document.getElementById("anim-algorithm").value;
    const mode = document.getElementById("user-difficulty").value;
    const speed = parseInt(document.getElementById("anim-speed").value, 10);
    runAnimation(algorithm, startNodeId, endNodeId, mode, speed);
  });
  document.getElementById("anim-stop-btn").addEventListener("click", stopAnimation);

  // Initial empty UI
  setEmptyUI();
}

// Use the exact same DIFF_COLOURS palette graph.js applies to the basemap
// pistes-layer, so the route piste segments match the underlying piste
// difficulty colour for every difficulty. (Previously this had its own
// hard-coded mapping which got out of sync — e.g. "easy" rendered green
// even though the basemap colours "easy" as blue.)
function pisteColourFromEdge(e) {
  return DIFF_COLOURS[(e.d || "").toLowerCase()] || "#888";
}

function drawRoute(map, graph, path, approachGeom) {
  // Emit one LineString feature per edge so each piste segment can render in
  // its own difficulty colour. Transition points dropped at every piste↔lift
  // boundary (the lift termini). Also collect the unique piste / lift names
  // present in the route so the dimming logic can preserve them.
  const lineFeatures = [];
  const transitionFeatures = [];
  const routePisteNames = new Set();
  const routeLiftNames  = new Set();

  function emitLeg(coords, props) {
    if (coords.length < 2) return;
    lineFeatures.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: props,
    });
  }
  function dedupedPush(arr, lonLat) {
    if (arr.length &&
        arr[arr.length - 1][0] === lonLat[0] &&
        arr[arr.length - 1][1] === lonLat[1]) return;
    arr.push(lonLat);
  }

  // Approach prefix (when pin A is free-form) — counted as piste.
  let prefixCoords = [];
  if (approachGeom && approachGeom.length >= 2) {
    for (const c of approachGeom) dedupedPush(prefixCoords, [c[1], c[0]]);
    if (prefixCoords.length >= 2) {
      emitLeg(prefixCoords, { kind: "piste", colour: "#888" });
    }
  }

  let prevKind = prefixCoords.length ? "piste" : null;
  let prevTail = prefixCoords.length ? prefixCoords[prefixCoords.length - 1] : null;

  for (const eIdx of path) {
    const e = graph.routingEdges[eIdx];
    if (!e.g) continue;
    const kind = (e.ty === "lift" || e.ty === "lift_down") ? "lift" : "piste";
    const colour = kind === "lift" ? "#8b5cf6" : pisteColourFromEdge(e);
    if (e.n) (kind === "lift" ? routeLiftNames : routePisteNames).add(e.n);

    // Build the leg's coords. If joining onto a previous tail, prefix with it.
    const coords = [];
    if (prevTail && prevKind !== kind) {
      coords.push(prevTail.slice());
      // Drop a transition dot at the boundary.
      transitionFeatures.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: prevTail.slice() },
        properties: { from: prevKind, to: kind },
      });
    }
    for (const c of e.g) dedupedPush(coords, [c[1], c[0]]);
    emitLeg(coords, { kind, colour, name: e.n || "" });
    prevKind = kind;
    prevTail = coords[coords.length - 1];
  }

  map.getSource("user-route").setData({
    type: "FeatureCollection",
    features: lineFeatures,
  });
  const tSrc = map.getSource("user-route-transitions");
  if (tSrc) tSrc.setData({ type: "FeatureCollection", features: transitionFeatures });

  // Expose route members so setRouteDimming can preserve their visibility.
  window._routeMembers = {
    pistes: Array.from(routePisteNames),
    lifts:  Array.from(routeLiftNames),
  };
}

// ============================================================
// Perf overlay
// ============================================================
export function wirePerfOverlay(map) {
  const fpsEl = document.getElementById("perf-fps");
  const frameMsEl = document.getElementById("perf-frame-ms");
  const tilesEl = document.getElementById("perf-tiles");
  // Perf overlay is dev-only chrome — if its DOM isn't present, skip
  // setting up any of the listeners.
  if (!fpsEl || !frameMsEl || !tilesEl) return;

  let frameCount = 0, frameAccum = 0;
  let lastTickMs = performance.now();
  map.on("render", () => {
    const now = performance.now();
    const dt = now - lastTickMs;
    lastTickMs = now;
    frameCount++;
    frameAccum += dt;
    if (frameAccum >= 500) {
      const fps = (frameCount * 1000) / frameAccum;
      fpsEl.textContent = fps.toFixed(0);
      fpsEl.className = fps < 25 ? "alert" : fps < 45 ? "hi" : "";
      frameMsEl.textContent = (frameAccum / frameCount).toFixed(1);
      frameCount = 0; frameAccum = 0;
    }
  });

  setInterval(() => {
    let total = 0;
    try {
      for (const src of Object.values(map.style.sourceCaches)) {
        if (src._tiles) total += Object.keys(src._tiles).length;
      }
    } catch (e) {}
    tilesEl.textContent = total;
  }, 500);
}
