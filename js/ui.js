/**
 * UI panel handlers — pin placement, route rendering, algorithm
 * visualisation animation, perf overlay. Operates on the modules
 * imported from routing.js + the live `map` + the loaded `graph`.
 */

import {
  runDijkstra, nearestNodeId, describeNode,
  DijkstraRunner, AstarRunner, BidirRunner, edgeCost,
} from "./routing.js";

export function wireRouting(map, graph) {
  let startPin = null, endPin = null;
  let startNodeId = null, endNodeId = null;

  function placePin(lat, lon, kind) {
    const nid = nearestNodeId(graph, lat, lon);
    if (nid === null) return null;
    return placePinAtNode(nid, kind);
  }

  function placePinAtNode(nid, kind) {
    const n = graph.routingNodes[nid];
    if (!n) return null;
    const el = document.createElement("div");
    el.className = "pin-marker" + (kind === "end" ? " end" : "");
    el.textContent = kind === "end" ? "B" : "A";
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([n[0], n[1]])
      .setPopup(new maplibregl.Popup({ offset: 18 }).setText(describeNode(graph, nid)))
      .addTo(map);
    return { marker, nodeId: nid };
  }

  function clearUserRoute() {
    if (startPin) { startPin.remove(); startPin = null; }
    if (endPin) { endPin.remove(); endPin = null; }
    startNodeId = null; endNodeId = null;
    if (map.getSource("user-route")) {
      map.getSource("user-route").setData({ type: "FeatureCollection", features: [] });
    }
    if (map.getSource("anim-settled")) {
      map.getSource("anim-settled").setData({ type: "FeatureCollection", features: [] });
    }
    stopAnimation();
    document.getElementById("user-route-info").innerHTML =
      '<em class="muted">Click the map to place a start pin.</em>';
    document.getElementById("anim-stats").innerHTML =
      "<em>Drop two pins, then press Animate.</em>";
  }

  // Layers that should snap pin placement to their feature coordinate
  // when clicked, instead of using the raw click location. This makes
  // the village name + the station dot themselves clickable targets.
  const SNAP_LAYERS = [
    "villages-layer", "villages-label",
    "stations-layer", "lift-labels",
  ];

  function pickClickCoord(ev) {
    const layers = SNAP_LAYERS.filter((id) => map.getLayer(id));
    if (!layers.length) return { lat: ev.lngLat.lat, lon: ev.lngLat.lng };
    const feats = map.queryRenderedFeatures(ev.point, { layers });
    if (feats.length) {
      const c = feats[0].geometry && feats[0].geometry.coordinates;
      if (c && c.length >= 2) return { lat: c[1], lon: c[0] };
    }
    return { lat: ev.lngLat.lat, lon: ev.lngLat.lng };
  }

  function handlePinClick({ lat, lon }) {
    const mode = document.getElementById("user-difficulty").value;
    const info = document.getElementById("user-route-info");

    if (startPin === null) {
      const r = placePin(lat, lon, "start");
      if (!r) return;
      startPin = r.marker; startNodeId = r.nodeId;
      info.innerHTML =
        '<div style="color:#22aa22">A: ' + describeNode(graph, r.nodeId) + "</div>" +
        '<em class="muted">Click again (map or a town name) to place the end pin.</em>';
      return;
    }
    if (endPin === null) {
      const r = placePin(lat, lon, "end");
      if (!r) return;
      endPin = r.marker; endNodeId = r.nodeId;
      const t0 = performance.now();
      const result = runDijkstra(startNodeId, endNodeId, mode, graph);
      const tMs = (performance.now() - t0).toFixed(0);
      if (result.path === null) {
        info.innerHTML =
          '<div style="color:#22aa22">A: ' + describeNode(graph, startNodeId) + "</div>" +
          '<div style="color:#dd2222">B: ' + describeNode(graph, endNodeId) + "</div>" +
          '<div style="color:#c33;margin-top:6px">No route found.</div>';
        return;
      }
      drawRoute(map, graph, result.path);
      const mins = Math.round(result.totalSeconds / 60);
      info.innerHTML =
        '<div style="color:#22aa22">A: ' + describeNode(graph, startNodeId) + "</div>" +
        '<div style="color:#dd2222">B: ' + describeNode(graph, endNodeId) + "</div>" +
        '<div style="margin-top:6px;font-size:16px;font-weight:700;color:#ffe000">' +
        mins + " min · " + result.path.length + " edges</div>" +
        '<div style="font-size:11px;color:#999">' +
        "Dijkstra visited " + result.visited + " nodes in " + tMs + " ms</div>";
      return;
    }
    clearUserRoute();
    const r = placePin(lat, lon, "start");
    if (!r) return;
    startPin = r.marker; startNodeId = r.nodeId;
    info.innerHTML =
      '<div style="color:#22aa22">A: ' + describeNode(graph, r.nodeId) + "</div>" +
      '<em class="muted">Click again to place the end pin.</em>';
  }

  map.on("click", (ev) => handlePinClick(pickClickCoord(ev)));

  // Pointer cursor over clickable named features so users discover them.
  for (const layerId of SNAP_LAYERS) {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  document.getElementById("clear-route-btn").addEventListener("click", clearUserRoute);

  // ----- Algorithm exploration animation -----
  let animTimer = null;
  let animFeatures = [];

  function stopAnimation() {
    if (animTimer !== null) { cancelAnimationFrame(animTimer); animTimer = null; }
    animFeatures = [];
    if (map.getSource("anim-settled")) {
      map.getSource("anim-settled").setData({ type: "FeatureCollection", features: [] });
    }
  }
  window.stopAnimation = stopAnimation;

  function runAnimation(algorithm, src, tgt, mode, nodesPerSec) {
    stopAnimation();
    let runner;
    if (algorithm === "astar") runner = new AstarRunner(src, tgt, mode, graph);
    else if (algorithm === "bidir") runner = new BidirRunner(src, tgt, mode, graph);
    else runner = new DijkstraRunner(src, tgt, mode, graph);

    const statsEl = document.getElementById("anim-stats");
    const t0 = performance.now();
    let lastTick = t0;

    function tick(now) {
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

      const elapsed = ((now - t0) / 1000).toFixed(1);
      statsEl.innerHTML = `${algorithm.toUpperCase()} — ${runner.iters} nodes · ${elapsed}s`;

      if (runner.done) {
        if (runner.foundPath && runner.foundPath.length) {
          drawRoute(map, graph, runner.foundPath);
          let totalSec = 0;
          runner.foundPath.forEach((eIdx) => {
            totalSec += edgeCost(graph.routingEdges[eIdx], mode);
          });
          statsEl.innerHTML =
            `<strong style="color:#ffe000">${algorithm.toUpperCase()}</strong> · ` +
            `${runner.iters} nodes settled · path ${runner.foundPath.length} edges · ` +
            `${Math.round(totalSec / 60)} min · wall ${elapsed}s`;
        } else {
          statsEl.innerHTML = `<strong style="color:#c33">${algorithm.toUpperCase()}: no route</strong>`;
        }
        animTimer = null;
        return;
      }
      animTimer = requestAnimationFrame(tick);
    }
    animTimer = requestAnimationFrame(tick);
  }

  document.getElementById("anim-speed").addEventListener("input", (e) => {
    document.getElementById("anim-speed-label").textContent = e.target.value;
  });
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
}

function drawRoute(map, graph, path) {
  const coords = [];
  path.forEach((eIdx) => {
    const e = graph.routingEdges[eIdx];
    if (!e.g) return;
    e.g.forEach((c) => {
      // e.g coords are [lat, lon]; MapLibre wants [lon, lat]
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

  // Wrap shadeMap.setDate once it exists
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
