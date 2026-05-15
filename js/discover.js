/**
 * Discover mode — read-only graph inspector.
 *
 * Drop pin A and pin B anywhere on the map; each pin snaps to the
 * nearest graph node and reports:
 *
 *   - node id, name, elevation, tagged village(s)
 *   - every outgoing edge (piste / lift / skate / connection / lift_down)
 *   - every incoming edge
 *
 * The user can copy a structured report describing both pins — the
 * intent is to feed that report into a manual override patch (e.g.
 * "connect these two nodes via a skate edge") without needing to
 * navigate the graph JSON by hand.
 *
 * No graph mutation happens here. The mode is strictly read-only.
 */

const SRC_PINS = "discover-pins";
const LAYER_PINS = "discover-pins-circle";
const LAYER_PINS_LABEL = "discover-pins-label";
const SRC_HIGHLIGHT = "discover-highlight";
const LAYER_HIGHLIGHT = "discover-highlight-line";
const SRC_NODES = "discover-nodes";
const LAYER_NODES = "discover-nodes-circle";
const SRC_AB = "discover-ab";
const LAYER_AB_CASING = "discover-ab-casing";
const LAYER_AB = "discover-ab-line";

// Lazy-imported so the discover module doesn't pull routing.js for users
// who never click "Test A → B".
let _routingModule = null;
async function getRouting() {
  if (!_routingModule) {
    _routingModule = await import("./routing.js?v=20260513");
  }
  return _routingModule;
}


export function wireDiscover(map, graph) {
  const state = {
    active: false,
    pinA: null,  // { lng, lat, nodeId }
    pinB: null,
    lastTest: null,  // { ok, mode, totalSeconds, legCount, reason, fwd, rev }
  };

  // --- DOM refs ------------------------------------------------------
  const els = {
    empty:        document.getElementById("discover-empty"),
    pinA:         document.getElementById("discover-pin-a"),
    pinB:         document.getElementById("discover-pin-b"),
    aCoords:      document.getElementById("discover-a-coords"),
    bCoords:      document.getElementById("discover-b-coords"),
    aInfo:        document.getElementById("discover-a-info"),
    bInfo:        document.getElementById("discover-b-info"),
    actions:      document.getElementById("discover-actions"),
    copyBtn:      document.getElementById("discover-copy-btn"),
    resetBtn:     document.getElementById("discover-reset-btn"),
    routeTest:    document.getElementById("discover-route-test"),
    routeMode:    document.getElementById("discover-route-mode"),
    testBtn:      document.getElementById("discover-test-btn"),
    routeResult:  document.getElementById("discover-route-result"),
  };
  if (!els.empty) {
    console.warn("[discover] DOM missing — discover panel not loaded?");
    return;
  }

  // --- Map layers ----------------------------------------------------
  function emptyFC() { return { type: "FeatureCollection", features: [] }; }

  function ensureLayers() {
    // Visible-node layer — every routing node as a small clickable dot.
    // Hides in non-discover modes (the layer is toggled in/out by
    // setDiscoverModeActive).
    if (!map.getSource(SRC_NODES)) {
      const features = [];
      for (const id in graph.routingNodes) {
        const n = graph.routingNodes[id];
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [n[0], n[1]] },
          properties: { id: parseInt(id, 10), name: n[3] || `node ${id}`, elev: n[2] },
        });
      }
      map.addSource(SRC_NODES, { type: "geojson", data: { type: "FeatureCollection", features } });
      map.addLayer({
        id: LAYER_NODES, type: "circle", source: SRC_NODES,
        layout: { visibility: "none" },
        paint: {
          // Smaller when zoomed out so dots don't carpet the screen
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 14, 3, 17, 5],
          "circle-color": "#ffaa00",
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 14, 0.85, 17, 1.0],
        },
      });
    }
    if (!map.getSource(SRC_PINS)) {
      map.addSource(SRC_PINS, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: LAYER_PINS, type: "circle", source: SRC_PINS,
        paint: {
          "circle-radius": 10,
          "circle-color": ["match", ["get", "letter"], "A", "#2466ff", "B", "#15130f", "#888"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });
      map.addLayer({
        id: LAYER_PINS_LABEL, type: "symbol", source: SRC_PINS,
        layout: {
          "text-field": ["get", "letter"],
          "text-size": 12,
          "text-font": ["Noto Sans Bold"],
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#fff",
          "text-halo-color": "rgba(0,0,0,0.2)",
          "text-halo-width": 1,
        },
      });
    }
    if (!map.getSource(SRC_HIGHLIGHT)) {
      map.addSource(SRC_HIGHLIGHT, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: LAYER_HIGHLIGHT, type: "line", source: SRC_HIGHLIGHT,
        paint: {
          "line-color": ["match", ["get", "side"], "A", "#2466ff", "B", "#15130f", "#888"],
          "line-width": 4,
          "line-opacity": 0.55,
        },
      }, LAYER_PINS);  // beneath the pin circles
    }
    // Connector line from A → B. Magenta + white casing so it can't be
    // confused with any piste/lift colour. Placed BELOW the pin circles
    // so the A/B disks still pop on top of the line ends.
    if (!map.getSource(SRC_AB)) {
      map.addSource(SRC_AB, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: LAYER_AB_CASING, type: "line", source: SRC_AB,
        paint: {
          "line-color": "#ffffff",
          "line-width": 9,
          "line-opacity": 0.9,
        },
      }, LAYER_PINS);
      map.addLayer({
        id: LAYER_AB, type: "line", source: SRC_AB,
        paint: {
          "line-color": "#ff1493",  // deep pink — unique on the resort palette
          "line-width": 5,
          "line-opacity": 1.0,
          "line-dasharray": [1.6, 1.2],
        },
      }, LAYER_PINS);
    }
  }

  function refreshPinSource() {
    const src = map.getSource(SRC_PINS);
    if (!src) return;
    const features = [];
    if (state.pinA) {
      const n = graph.routingNodes[state.pinA.nodeId];
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [n[0], n[1]] },
        properties: { letter: "A" },
      });
    }
    if (state.pinB) {
      const n = graph.routingNodes[state.pinB.nodeId];
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [n[0], n[1]] },
        properties: { letter: "B" },
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }

  function refreshAbConnector() {
    const src = map.getSource(SRC_AB);
    if (!src) return;
    if (!state.pinA || !state.pinB) {
      src.setData(emptyFC());
      return;
    }
    const a = graph.routingNodes[state.pinA.nodeId];
    const b = graph.routingNodes[state.pinB.nodeId];
    if (!a || !b) { src.setData(emptyFC()); return; }
    src.setData({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[a[0], a[1]], [b[0], b[1]]] },
        properties: {},
      }],
    });
  }

  function refreshHighlights() {
    const src = map.getSource(SRC_HIGHLIGHT);
    if (!src) return;
    const features = [];
    function addEdgesFor(nodeId, letter) {
      if (nodeId == null) return;
      for (let i = 0; i < graph.routingEdges.length; i++) {
        const e = graph.routingEdges[i];
        if (e.f !== nodeId && e.t !== nodeId) continue;
        if (!e.g || e.g.length < 2) continue;
        // e.g is stored [lat, lon] — flip for GeoJSON
        const coords = e.g.map(c => [c[1], c[0]]);
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: { side: letter },
        });
      }
    }
    if (state.pinA) addEdgesFor(state.pinA.nodeId, "A");
    if (state.pinB) addEdgesFor(state.pinB.nodeId, "B");
    src.setData({ type: "FeatureCollection", features });
  }

  // --- Snap to nearest graph node -----------------------------------
  // graph.routingNodes is {id -> [lon, lat, elev, name]}.
  // Equirectangular projection at the bbox centroid is plenty accurate
  // at resort scale and far faster than haversine per node.
  let lonScale = 1, latScale = 1, scaleReady = false;
  function ensureScale() {
    if (scaleReady) return;
    let latSum = 0, n = 0;
    for (const id in graph.routingNodes) {
      latSum += graph.routingNodes[id][1];
      n++;
    }
    const meanLat = (n ? latSum / n : 45) * Math.PI / 180;
    latScale = 111320;
    lonScale = 111320 * Math.cos(meanLat);
    scaleReady = true;
  }

  function nearestNodeId(lng, lat) {
    ensureScale();
    let best = null, bestD2 = Infinity;
    for (const id in graph.routingNodes) {
      const n = graph.routingNodes[id];
      const dx = (n[0] - lng) * lonScale;
      const dy = (n[1] - lat) * latScale;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = id; }
    }
    return best == null ? null : { id: parseInt(best, 10), distance_m: Math.sqrt(bestD2) };
  }

  // --- Edge enumeration ---------------------------------------------
  function edgesIncidentTo(nodeId) {
    const out = [], inc = [];
    for (let i = 0; i < graph.routingEdges.length; i++) {
      const e = graph.routingEdges[i];
      if (e.f === nodeId) out.push(e);
      if (e.t === nodeId) inc.push(e);
    }
    return { out, inc };
  }

  function badge(type) {
    return `<span class="badge ${type}">${type}</span>`;
  }
  function edgeListHtml(edges, dirLabel) {
    if (!edges.length) return `<li class="meta">no ${dirLabel} edges</li>`;
    return edges.map(e => {
      const otherId = dirLabel === "out" ? e.t : e.f;
      const otherNode = graph.routingNodes[otherId];
      const otherName = (otherNode && otherNode[3]) || `#${otherId}`;
      const featName = e.n && !e.n.startsWith("Skate ") ? e.n : "";
      const meta = e.d ? e.d : (e.lt || "");
      return `<li>${badge(e.ty)}<span class="name">${escapeHtml(featName || "")} ${dirLabel === "out" ? "→" : "←"} ${escapeHtml(otherName)} <span class="meta">[node ${otherId}]</span></span><span class="meta">${escapeHtml(meta)}</span></li>`;
    }).join("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function renderPin(letter) {
    const slot = letter === "A" ? state.pinA : state.pinB;
    const pinEl     = letter === "A" ? els.pinA    : els.pinB;
    const coordsEl  = letter === "A" ? els.aCoords : els.bCoords;
    const infoEl    = letter === "A" ? els.aInfo   : els.bInfo;
    if (!slot) {
      pinEl.hidden = true;
      return;
    }
    pinEl.hidden = false;
    const n = graph.routingNodes[slot.nodeId];
    const villageTags = inferVillageTags(slot.nodeId);
    const villageStr = villageTags.length ? villageTags.join(", ") : "—";
    coordsEl.textContent = `node ${slot.nodeId}  ·  ${slot.lng.toFixed(5)}, ${slot.lat.toFixed(5)}  ·  snap ${slot.snapM.toFixed(0)}m`;
    const { out, inc } = edgesIncidentTo(slot.nodeId);
    infoEl.innerHTML = `
      <div><span class="label">Name</span><strong>${escapeHtml(n[3] || `node ${slot.nodeId}`)}</strong></div>
      <div><span class="label">Elev</span>${n[2].toFixed(0)} m</div>
      <div><span class="label">Villages</span>${escapeHtml(villageStr)}</div>
      <div><span class="label">Outgoing</span>${out.length}</div>
      <ul>${edgeListHtml(out, "out")}</ul>
      <div><span class="label">Incoming</span>${inc.length}</div>
      <ul>${edgeListHtml(inc, "in")}</ul>
    `;
  }

  function inferVillageTags(nodeId) {
    // The compact routingNodes representation drops villages, but the raw
    // graph kept on the graph object preserves them when available.
    if (graph.raw && graph.raw.nodes) {
      const n = graph.raw.nodes.find(x => x.id === nodeId);
      if (n) return n.villages || n.destinations || [];
    }
    return [];
  }

  function renderEmpty() {
    const noPins = !state.pinA && !state.pinB;
    const bothPins = !!(state.pinA && state.pinB);
    els.empty.hidden = !noPins;
    els.actions.hidden = noPins;
    if (els.routeTest) els.routeTest.hidden = !bothPins;
    renderRouteResult();
  }

  function renderRouteResult() {
    if (!els.routeResult) return;
    const t = state.lastTest;
    if (!t) {
      els.routeResult.className = "discover-route-result idle";
      els.routeResult.textContent = '— click "Test A → B" to check connectivity';
      return;
    }
    if (t.ok) {
      els.routeResult.className = "discover-route-result ok";
      els.routeResult.textContent =
        `✓ Route exists  ·  ${t.mode}  ·  ${(t.totalSeconds/60).toFixed(1)} min  ·  ${t.legCount} edges`;
    } else {
      els.routeResult.className = "discover-route-result fail";
      els.routeResult.textContent =
        `✗ NO ROUTE  ·  ${t.mode}\n` +
        `   reason:        ${t.reason}\n` +
        `   fwd-reachable: ${t.fwd}  (from A, capped)\n` +
        `   rev-reachable: ${t.rev}  (into B, capped)`;
    }
  }

  async function runRouteTest() {
    if (!state.pinA || !state.pinB) return;
    const mode = (els.routeMode && els.routeMode.value) || "any-piste";
    els.routeResult.className = "discover-route-result idle";
    els.routeResult.textContent = "running Dijkstra…";
    try {
      const routing = await getRouting();
      const result = routing.runDijkstra(state.pinA.nodeId, state.pinB.nodeId, mode, graph);
      if (result && result.path) {
        state.lastTest = {
          ok: true,
          mode,
          totalSeconds: result.totalSeconds || 0,
          legCount: result.path.length,
        };
      } else {
        const POCKET = 25, PROBE = POCKET + 1;
        const fwd = routing.reachableCount(graph, state.pinA.nodeId, { limit: PROBE });
        const rev = routing.reachableCount(graph, state.pinB.nodeId, { limit: PROBE, reverse: true });
        let reason;
        if (fwd <= POCKET && rev > POCKET)        reason = `start_pocket (${fwd} reachable from A)`;
        else if (rev <= POCKET && fwd > POCKET)   reason = `end_pocket (${rev} reach B)`;
        else if (fwd <= POCKET && rev <= POCKET)  reason = `both_in_pockets (start=${fwd}, end=${rev})`;
        else                                       reason = `no_path (likely missing one-way edge)`;
        state.lastTest = { ok: false, mode, reason, fwd, rev };
      }
    } catch (err) {
      state.lastTest = { ok: false, mode, reason: "error: " + err.message, fwd: 0, rev: 0 };
    }
    renderRouteResult();
  }

  // --- Click handling -----------------------------------------------
  function onMapClick(ev) {
    if (!state.active) return;
    // Prefer a direct hit on a visible node dot (deterministic) before
    // falling back to nearest-by-distance from the cursor.
    let nodeId, distance_m;
    const hits = map.queryRenderedFeatures(ev.point, { layers: [LAYER_NODES] });
    if (hits.length) {
      nodeId = hits[0].properties.id;
      const n = graph.routingNodes[nodeId];
      ensureScale();
      const dx = (n[0] - ev.lngLat.lng) * lonScale;
      const dy = (n[1] - ev.lngLat.lat) * latScale;
      distance_m = Math.sqrt(dx * dx + dy * dy);
    } else {
      const snap = nearestNodeId(ev.lngLat.lng, ev.lngLat.lat);
      if (!snap) return;
      nodeId = snap.id; distance_m = snap.distance_m;
    }
    const slot = {
      lng: ev.lngLat.lng,
      lat: ev.lngLat.lat,
      nodeId,
      snapM: distance_m,
    };
    if (!state.pinA) {
      state.pinA = slot;
    } else if (!state.pinB) {
      state.pinB = slot;
    } else {
      // Both pins set — rotate (drop the oldest, treat this click as the new B).
      state.pinA = state.pinB;
      state.pinB = slot;
    }
    state.lastTest = null;  // pin pair changed → stale test result
    renderPin("A"); renderPin("B"); renderEmpty();
    refreshPinSource(); refreshHighlights(); refreshAbConnector();
  }

  // --- Report --------------------------------------------------------
  function buildReport() {
    function describe(slot, letter) {
      if (!slot) return `${letter}: (not placed)`;
      const n = graph.routingNodes[slot.nodeId];
      const tags = inferVillageTags(slot.nodeId);
      const { out, inc } = edgesIncidentTo(slot.nodeId);
      const lines = [];
      lines.push(`${letter}: ${n[3] || `node ${slot.nodeId}`}  (node ${slot.nodeId})`);
      lines.push(`   coord:    ${slot.lat.toFixed(5)}, ${slot.lng.toFixed(5)}`);
      lines.push(`   elev:     ${n[2].toFixed(0)} m   snap: ${slot.snapM.toFixed(0)} m`);
      if (tags.length) lines.push(`   villages: ${tags.join(", ")}`);
      lines.push(`   outgoing (${out.length}):`);
      for (const e of out) {
        const tn = graph.routingNodes[e.t];
        lines.push(`     ${e.ty.padEnd(11)} ${(e.n || "").slice(0, 28).padEnd(28)} → ${tn ? tn[3] : "?"} [node ${e.t}]`);
      }
      lines.push(`   incoming (${inc.length}):`);
      for (const e of inc) {
        const fn = graph.routingNodes[e.f];
        lines.push(`     ${e.ty.padEnd(11)} ${(e.n || "").slice(0, 28).padEnd(28)} ← ${fn ? fn[3] : "?"} [node ${e.f}]`);
      }
      return lines.join("\n");
    }
    const parts = [describe(state.pinA, "A"), describe(state.pinB, "B")];
    if (state.pinA && state.pinB) {
      const a = graph.routingNodes[state.pinA.nodeId];
      const b = graph.routingNodes[state.pinB.nodeId];
      // Straight-line distance between the snapped nodes
      ensureScale();
      const dx = (a[0] - b[0]) * lonScale;
      const dy = (a[1] - b[1]) * latScale;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dh = b[2] - a[2];

      // Check if either node name is shared with other nodes (collisions
      // break name-based overrides — find_nodes_by_name returns the first
      // match, which may not be the user's intended node).
      const sameName = (name) => {
        let count = 0;
        for (const id in graph.routingNodes) {
          if (graph.routingNodes[id][3] === name) count++;
        }
        return count;
      };
      const aName = a[3] || `node ${state.pinA.nodeId}`;
      const bName = b[3] || `node ${state.pinB.nodeId}`;
      const aDupes = sameName(aName);
      const bDupes = sameName(bName);
      const collisions = aDupes > 1 || bDupes > 1 || aName === bName;

      parts.push(
        "Pair:",
        `   ${aName}  →  ${bName}`,
        `   ${dist.toFixed(0)} m straight-line, Δelev ${dh >= 0 ? "+" : ""}${dh.toFixed(0)} m`,
      );

      // Include the Test A → B result if the user ran it.
      if (state.lastTest) {
        const t = state.lastTest;
        if (t.ok) {
          parts.push(
            "Route test:",
            `   ✓ route exists  ·  mode=${t.mode}  ·  ${(t.totalSeconds/60).toFixed(1)} min  ·  ${t.legCount} edges`,
          );
        } else {
          parts.push(
            "Route test:",
            `   ✗ NO ROUTE  ·  mode=${t.mode}`,
            `   reason:        ${t.reason}`,
            `   fwd-reachable: ${t.fwd}  (from A, capped)`,
            `   rev-reachable: ${t.rev}  (into B, capped)`,
          );
        }
      } else {
        parts.push("Route test:  (not run — click 'Test A → B' in Discover panel)");
      }

      if (collisions) {
        const why = [];
        if (aDupes > 1) why.push(`'${aName}' matches ${aDupes} nodes`);
        if (bDupes > 1) why.push(`'${bName}' matches ${bDupes} nodes`);
        if (aName === bName) why.push("both pins share a name");
        parts.push(
          `⚠ Name collision: ${why.join("; ")}. Use the from_id/to_id variant below.`,
          "",
          "Suggested override (by node ID — unambiguous):",
          JSON.stringify({
            add_edges: [{
              from_id: state.pinA.nodeId,
              to_id: state.pinB.nodeId,
              type: "skate",
            }],
          }, null, 2),
        );
      } else {
        parts.push(
          "",
          "Suggested override (one-way A → B skate):",
          JSON.stringify({
            add_edges: [{
              from_name: aName,
              to_name: bName,
              type: "skate",
            }],
          }, null, 2),
        );
      }
    }
    return parts.join("\n\n");
  }

  function copyReport() {
    const text = buildReport();
    const done = () => {
      els.copyBtn.textContent = "Copied ✓";
      els.copyBtn.classList.add("copied");
      setTimeout(() => {
        els.copyBtn.textContent = "Copy report";
        els.copyBtn.classList.remove("copied");
      }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
    done();
  }

  function reset() {
    state.pinA = null; state.pinB = null; state.lastTest = null;
    renderPin("A"); renderPin("B"); renderEmpty();
    refreshPinSource(); refreshHighlights(); refreshAbConnector();
  }

  // --- Wire ---------------------------------------------------------
  els.copyBtn.addEventListener("click", copyReport);
  els.resetBtn.addEventListener("click", reset);
  if (els.testBtn) els.testBtn.addEventListener("click", runRouteTest);

  ensureLayers();
  map.on("click", onMapClick);

  // Hover tooltip over visible nodes — confirms the id+name before clicking.
  const hoverPopup = new maplibregl.Popup({
    closeButton: false, closeOnClick: false, offset: 10,
  });
  map.on("mouseenter", LAYER_NODES, (ev) => {
    if (!state.active) return;
    map.getCanvas().style.cursor = "pointer";
    const f = ev.features && ev.features[0];
    if (!f) return;
    const p = f.properties;
    hoverPopup
      .setLngLat(f.geometry.coordinates)
      .setHTML(`<strong>${p.name}</strong><br><span style="font-size:11px;color:#666">node ${p.id} · ${Number(p.elev).toFixed(0)} m</span>`)
      .addTo(map);
  });
  map.on("mousemove", LAYER_NODES, (ev) => {
    if (!state.active) return;
    const f = ev.features && ev.features[0];
    if (!f) return;
    hoverPopup.setLngLat(f.geometry.coordinates);
  });
  map.on("mouseleave", LAYER_NODES, () => {
    map.getCanvas().style.cursor = "";
    hoverPopup.remove();
  });

  // Expose on both the namespace and the legacy flat global. See
  // window._ski catalogue in app.js for the full list of shared state.
  const setActive = (on) => {
    state.active = !!on;
    if (map.getLayer(LAYER_NODES)) {
      map.setLayoutProperty(LAYER_NODES, "visibility", on ? "visible" : "none");
    }
    if (!on) {
      hoverPopup.remove();
      const ps = map.getSource(SRC_PINS); if (ps) ps.setData(emptyFC());
      const hs = map.getSource(SRC_HIGHLIGHT); if (hs) hs.setData(emptyFC());
      const ab = map.getSource(SRC_AB); if (ab) ab.setData(emptyFC());
    } else {
      refreshPinSource(); refreshHighlights(); refreshAbConnector();
    }
  };
  (window._ski = window._ski || {}).setDiscoverModeActive = setActive;
  window._setDiscoverModeActive = setActive;  // legacy alias

  renderEmpty();
}
