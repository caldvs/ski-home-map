/**
 * UI panel handlers — pin placement, route rendering, algorithm
 * visualisation animation, perf overlay. Operates on the modules
 * imported from routing.js + the live `map` + the loaded `graph`.
 */

import {
  runDijkstra, nearestNodeId, nearestPisteOrLiftNodeId, describeNode,
  DijkstraRunner, AstarRunner, BidirRunner, edgeCost,
  reachableCount,
} from "./routing.js";
import { renderElevationProfile, disposeElevationProfile } from "./elevation.js";
import { renderItinerary, disposeItinerary } from "./itinerary.js";

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
  return (n[3] || `node ${id}`).replace(/\s+\(top\)|\s+\(bottom\)/i, "");
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

function setRouteUI(graph, startId, endId, result) {
  const summary = summariseRoute(graph, result.path, result.totalSeconds);

  // A→B status line
  const info = document.getElementById("user-route-info");
  info.innerHTML = `
    <div class="ab-status">
      <span class="pin-dot">A</span>
      <span>${describeNodeShort(graph, startId)}</span>
      <span class="arrow">→</span>
      <span class="pin-dot b">B</span>
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

function setNoRouteUI(graph, startId, endId, fwd, rev, threshold, total) {
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
      <span>${describeNodeShort(graph, startId)}</span>
      <span class="arrow">→</span>
      <span class="pin-dot b">B</span>
      <span>${describeNodeShort(graph, endId)}</span>
    </div>
    <div style="margin-top:6px;font-size:11.5px;color:var(--accent);font-family:Geist,sans-serif">${why}</div>`;
}

export function wireRouting(map, graph) {
  let startPin = null, endPin = null;
  let startNodeId = null, endNodeId = null;
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
  function setStartApproach(forceNid) {
    const src = map.getSource("start-approach");
    if (!src) return;
    const nid = (forceNid != null) ? forceNid : startNodeId;
    if (!startDisplay || nid == null) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const node = graph.routingNodes[nid];
    if (!node) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const dLon = Math.abs(node[0] - startDisplay.lon);
    const dLat = Math.abs(node[1] - startDisplay.lat);
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
            [node[0], node[1]],
          ],
        },
        properties: {},
      }],
    });
  }

  // Build a pin marker. kind = "start" → free-form, displayed at
  // (displayLat, displayLon). kind = "end" → snapped to a piste/lift
  // node, displayed at that node's coordinates.
  function placePin(lat, lon, kind) {
    if (kind === "start") {
      // Pin A is free-form: the visible marker sits where the user
      // clicked, but the route source is always a piste / lift node
      // (so the algorithm has something to start from). The dashed
      // approach line bridges the two.
      const nid = nearestPisteOrLiftNodeId(graph, lat, lon);
      if (nid === null) return null;
      startDisplay = { lat, lon };
      const r = buildMarker(lat, lon, kind, nid);
      setStartApproach(nid);
      return r;
    }
    // Pin B: visibly snaps to the nearest piste / lift node.
    const nid = nearestPisteOrLiftNodeId(graph, lat, lon);
    if (nid === null) return null;
    const n = graph.routingNodes[nid];
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

      // Both pins use the piste/lift node filter — pin A is just
      // additionally free in WHERE its visible marker sits.
      const newNid = nearestPisteOrLiftNodeId(graph, nlat, nlon);
      if (newNid === null) {
        // No valid node — snap pin back to the previous position.
        marker.setLngLat([lon, lat]);
        return;
      }
      const newN = graph.routingNodes[newNid];
      if (kind === "start") {
        // Free-form: leave the pin wherever the user dropped it
        // (snapped to point-feature if relevant), update routing source.
        marker.setLngLat([nlon, nlat]);
        startDisplay = { lat: nlat, lon: nlon };
        startNodeId = newNid;
        popup.setText(describeNode(graph, newNid));
        setStartApproach(newNid);
      } else {
        // Pin B always sits AT the snapped node.
        marker.setLngLat([newN[0], newN[1]]);
        popup.setText(describeNode(graph, newNid));
        endNodeId = newNid;
      }
      if (startNodeId !== null && endNodeId !== null) recomputeRoute();
    });

    return { marker, nodeId: nid };
  }

  function clearUserRoute() {
    if (startPin) { startPin.remove(); startPin = null; }
    if (endPin) { endPin.remove(); endPin = null; }
    startNodeId = null; endNodeId = null;
    startDisplay = null;
    if (map.getSource("start-approach")) {
      map.getSource("start-approach").setData({ type: "FeatureCollection", features: [] });
    }
    if (map.getSource("user-route")) {
      map.getSource("user-route").setData({ type: "FeatureCollection", features: [] });
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
    const result = runDijkstra(startNodeId, endNodeId, mode, graph);
    const tMs = (performance.now() - t0).toFixed(0);
    if (result.path === null) {
      const POCKET_THRESHOLD = 25;
      const PROBE = POCKET_THRESHOLD + 1;
      const totalNodes = graph.routingNodes.length;
      const fwd = reachableCount(graph, startNodeId, { limit: PROBE });
      const rev = reachableCount(graph, endNodeId,   { limit: PROBE, reverse: true });
      setNoRouteUI(graph, startNodeId, endNodeId, fwd, rev, POCKET_THRESHOLD, totalNodes);
      if (map.getSource("user-route")) {
        map.getSource("user-route").setData({ type: "FeatureCollection", features: [] });
      }
      disposeElevationProfile(document.getElementById("elevation-profile"));
      disposeItinerary(document.getElementById("itinerary"));
      return;
    }
    drawRoute(map, graph, result.path);
    setRouteUI(graph, startNodeId, endNodeId, result);
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
        <span>${describeNodeShort(graph, r3.nodeId)}</span>
        <span class="arrow">→</span>
        <span class="empty">Click again to place pin B.</span>
      </div>`;
  }
  map.on("click", (ev) => handlePinClick(pickClickCoord(ev)));

  for (const layerId of SNAP_LAYERS) {
    map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
  }

  // Optional Clear button (hidden in new chrome but still wired for safety)
  const clearBtn = document.getElementById("clear-route-btn");
  if (clearBtn) clearBtn.addEventListener("click", clearUserRoute);

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
          drawRoute(map, graph, runner.foundPath);
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

function drawRoute(map, graph, path) {
  const coords = [];
  path.forEach((eIdx) => {
    const e = graph.routingEdges[eIdx];
    if (!e.g) return;
    e.g.forEach((c) => {
      const lonLat = [c[1], c[0]];
      if (coords.length &&
          coords[coords.length - 1][0] === lonLat[0] &&
          coords[coords.length - 1][1] === lonLat[1]) return;
      coords.push(lonLat);
    });
  });
  map.getSource("user-route").setData({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {},
    }],
  });
}

// ============================================================
// Perf overlay
// ============================================================
export function wirePerfOverlay(map, getShadeMap) {
  const fpsEl = document.getElementById("perf-fps");
  const frameMsEl = document.getElementById("perf-frame-ms");
  const shadowMsEl = document.getElementById("perf-shadow-ms");
  const tilesEl = document.getElementById("perf-tiles");

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

  const wrapShadeTiming = () => {
    const sm = getShadeMap();
    if (!sm || sm.__wrappedTiming) return;
    sm.__wrappedTiming = true;
    const orig = sm.setDate.bind(sm);
    const ring = [];
    sm.setDate = function (d) {
      const t0 = performance.now();
      const r = orig(d);
      const t1 = performance.now();
      ring.push(t1 - t0);
      if (ring.length > 20) ring.shift();
      const avg = ring.reduce((a, b) => a + b, 0) / ring.length;
      shadowMsEl.textContent = avg.toFixed(1);
      shadowMsEl.className = avg > 50 ? "alert" : avg > 20 ? "hi" : "";
      return r;
    };
  };
  setTimeout(wrapShadeTiming, 500);
  setInterval(wrapShadeTiming, 2000);

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
