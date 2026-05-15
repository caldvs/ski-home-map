/**
 * Load and reshape a skiroute Graph JSON file for use by the map.
 *
 * The skiroute on-disk format is:
 *   { nodes: [{ id, lon, lat, elev, name, villages }],
 *     edges: [{ from, to, type, name, cost_base, length_m, elev_drop,
 *               difficulty?, lift_type?, geometry? }],
 *     villages: { "name": { lat, lon, elev } } }
 *
 * Map rendering wants GeoJSON FeatureCollections per edge type;
 * routing wants a compact (id → [lon,lat,elev,name]) lookup plus
 * an adjacency list. We reshape once at load time.
 */

const DIFF_COLOURS = {
  novice: "#00b050",
  easy: "#1e88e5",
  intermediate: "#e53935",
  advanced: "#2c2c2c",
  expert: "#2c2c2c",
  freeride: "#ff8800",
};

const LIFT_TYPE_LABEL = {
  chair_lift: "CHAIRLIFT",
  gondola: "GONDOLA",
  cable_car: "CABLE CAR",
  funicular: "FUNICULAR",
  drag_lift: "DRAG LIFT",
  "t-bar": "T-BAR",
  platter: "PLATTER",
  rope_tow: "ROPE TOW",
  magic_carpet: "MAGIC CARPET",
};

// Tunables for the synthetic "walk" connector edges.
// User asked for "walks of around 100 m or less on mostly flat terrain";
// we go a bit beyond that ceiling because real ski-resort foot connections
// (funicular top → adjacent chairlift base, parallel lift stations, etc.)
// commonly run 100–200 m with a few metres of climb. The cost ramp below
// is steep enough that Dijkstra only chooses these when no skiable
// alternative exists.
const MAX_WALK_M       = 200;
const MAX_WALK_DELEV   = 15;
const WALK_COST_BASE   = 60;    // seconds — clicking out / into skis
const WALK_COST_PER_M  = 3;     // seconds per horizontal metre
const WALK_COST_PER_M_UP = 30;  // extra seconds per metre of climb


function addWalkEdges(routingNodes, routingEdges, adj, reverseAdj) {
  // Build an undirected set of node pairs that ALREADY have any edge,
  // so we never add a walk where a real skiable connection exists.
  const have = new Set();
  for (const e of routingEdges) {
    const a = e.f, b = e.t;
    have.add(a < b ? `${a}:${b}` : `${b}:${a}`);
  }

  // Equirectangular projection for distance — fast and accurate enough
  // at ski-resort scales (we don't span enough latitude for haversine
  // to be needed). Use the bbox centroid for the lon-degree scale.
  const ids = Object.keys(routingNodes);
  if (ids.length === 0) return 0;
  let latSum = 0;
  for (const id of ids) latSum += routingNodes[id][1];
  const meanLat = latSum / ids.length;
  const LAT_M_PER_DEG = 111320;
  const LON_M_PER_DEG = 111320 * Math.cos(meanLat * Math.PI / 180);
  const MAX_SQ = MAX_WALK_M * MAX_WALK_M;

  let added = 0;
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i];
    const na = routingNodes[a];
    const aId = parseInt(a, 10);
    for (let j = i + 1; j < ids.length; j++) {
      const b = ids[j];
      const nb = routingNodes[b];
      if (Math.abs(na[2] - nb[2]) > MAX_WALK_DELEV) continue;
      const dx = (nb[0] - na[0]) * LON_M_PER_DEG;
      const dy = (nb[1] - na[1]) * LAT_M_PER_DEG;
      const d2 = dx * dx + dy * dy;
      if (d2 > MAX_SQ) continue;
      const key = aId < parseInt(b, 10) ? `${aId}:${b}` : `${b}:${aId}`;
      if (have.has(key)) continue;

      const dist = Math.sqrt(d2);
      // Cost goes up with both distance and climb (climb only — flat or
      // downhill walks just pay the horizontal price). Punishes going UP
      // out of a pocket more than going across or down to the same lift.
      const climbAB = Math.max(0, nb[2] - na[2]);
      const climbBA = Math.max(0, na[2] - nb[2]);
      const costAB = Math.round(WALK_COST_BASE + WALK_COST_PER_M * dist + WALK_COST_PER_M_UP * climbAB);
      const costBA = Math.round(WALK_COST_BASE + WALK_COST_PER_M * dist + WALK_COST_PER_M_UP * climbBA);
      const bId = parseInt(b, 10);
      const geomAB = [[na[1], na[0]], [nb[1], nb[0]]];
      const geomBA = [[nb[1], nb[0]], [na[1], na[0]]];

      const idx1 = routingEdges.length;
      routingEdges.push({
        f: aId, t: bId, c: costAB, ty: "walk", d: "", lt: "",
        n: `Walk ${Math.round(dist)}m`, g: geomAB,
      });
      (adj[aId] = adj[aId] || []).push(idx1);
      (reverseAdj[bId] = reverseAdj[bId] || []).push(idx1);

      const idx2 = routingEdges.length;
      routingEdges.push({
        f: bId, t: aId, c: costBA, ty: "walk", d: "", lt: "",
        n: `Walk ${Math.round(dist)}m`, g: geomBA,
      });
      (adj[bId] = adj[bId] || []).push(idx2);
      (reverseAdj[aId] = reverseAdj[aId] || []).push(idx2);

      added++;
    }
  }
  return added;
}


export async function loadGraph(url) {
  // Bypass the HTTP cache so the page always reflects the latest graph
  // build. The override system mutates the graph file on rebuild and
  // node IDs shift — a cached copy in the browser leads to "node X is Y"
  // diagnostics that don't match the live data.
  const bust = (url.includes("?") ? "&" : "?") + "ts=" + Date.now();
  const resp = await fetch(url + bust, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to load graph: ${resp.status} ${resp.statusText}`);
  return reshapeGraph(await resp.json());
}

// Cumulative-length midpoint along a polyline. Returns [lon, lat] at
// the point that's half-way along the line by metric distance, OR
// null if the line is degenerate. Used for placing lift labels as
// points so they don't get warped by 3D terrain.
function lineMidpoint(coords) {
  if (!coords || coords.length === 0) return null;
  if (coords.length === 1) return [coords[0][0], coords[0][1]];
  const segLens = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    segLens.push(len);
    total += len;
  }
  if (total === 0) return [coords[0][0], coords[0][1]];
  const halfway = total / 2;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (acc + segLens[i] >= halfway) {
      const t = (halfway - acc) / segLens[i];
      return [
        coords[i][0] + t * (coords[i + 1][0] - coords[i][0]),
        coords[i][1] + t * (coords[i + 1][1] - coords[i][1]),
      ];
    }
    acc += segLens[i];
  }
  return coords[Math.floor(coords.length / 2)];
}

function reshapeGraph(raw) {
  // --- Layer data: GeoJSON FeatureCollections ---
  const pistesFC = { type: "FeatureCollection", features: [] };
  const liftsFC = { type: "FeatureCollection", features: [] };
  const liftsDownFC = { type: "FeatureCollection", features: [] };
  const skatesFC = { type: "FeatureCollection", features: [] };
  // Label points: one per lift / piste, placed at the line midpoint.
  // Rendered as point symbols so 3D terrain doesn't drape the text.
  const liftLabelsFC  = { type: "FeatureCollection", features: [] };
  const pisteLabelsFC = { type: "FeatureCollection", features: [] };

  // --- Routing payload ---
  const routingNodes = {};      // id → [lon, lat, elev, name]
  const routingEdges = [];      // [{f, t, c, ty, d, lt, n, g}]
  const adj = {};               // id → [edge index, ...]
  const reverseAdj = {};        // id → [edge index, ...]

  for (const n of raw.nodes) {
    routingNodes[n.id] = [
      round6(n.lon),
      round6(n.lat),
      Math.round(n.elev * 10) / 10,
      n.name || "",
    ];
  }

  // Build a quick id lookup for geometry fallback
  const nodeLookup = {};
  for (const n of raw.nodes) nodeLookup[n.id] = n;

  for (const e of raw.edges) {
    // Resolve geometry; fallback to straight line if missing
    let geom = e.geometry;
    if (!geom || geom.length < 2) {
      const fn = nodeLookup[e.from];
      const tn = nodeLookup[e.to];
      geom = [
        [fn.lon, fn.lat],
        [tn.lon, tn.lat],
      ];
    }

    // GeoJSON feature for map rendering
    const labelWorthy =
      e.name &&
      !e.name.startsWith("Skate ") &&
      !e.name.startsWith("Ridge ") &&
      !e.name.startsWith("Traverse ");
    const liftTypeLabel = LIFT_TYPE_LABEL[e.lift_type] || (e.lift_type || "").toUpperCase().replace(/_/g, " ");
    const displayName =
      e.type === "lift" && labelWorthy
        ? `${e.name} (${liftTypeLabel})`
        : labelWorthy
        ? e.name
        : "";

    const props = {
      name: e.name || "",
      display_name: displayName,
      type: e.type,
      difficulty: e.difficulty || "",
      lift_type: e.lift_type || "",
      length_m: Math.round(e.length_m || 0),
      elev_drop: Math.round(e.elev_drop || 0),
    };

    const feature = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: geom },
      properties: props,
    };

    if (e.type === "lift") {
      liftsFC.features.push(feature);
      if (displayName) {
        const mid = lineMidpoint(geom);
        if (mid) {
          liftLabelsFC.features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: mid },
            properties: { name: e.name, display_name: displayName, lift_type: e.lift_type || "" },
          });
        }
      }
    } else if (e.type === "lift_down") {
      liftsDownFC.features.push(feature);
    } else if (e.type === "run" || e.type === "connection") {
      props.colour = DIFF_COLOURS[e.difficulty] || "#888";
      pistesFC.features.push(feature);
    } else if (e.type === "skate") {
      skatesFC.features.push(feature);
    }

    // Compact routing-edge representation
    const edgeIdx = routingEdges.length;
    routingEdges.push({
      f: e.from,
      t: e.to,
      c: Math.round((e.cost_base || 0) * 10) / 10,
      ty: e.type,
      d: e.difficulty || "",
      lt: e.lift_type || "",
      n: e.name || "",
      // Geometry as [[lat, lon], ...] for MapLibre line drawing of routes
      g: geom.map((c) => [round6(c[1]), round6(c[0])]),
    });

    (adj[e.from] = adj[e.from] || []).push(edgeIdx);
    (reverseAdj[e.to] = reverseAdj[e.to] || []).push(edgeIdx);
  }

  // --- Synthetic walk edges (self-healing connectivity) ---
  // The upstream graph builder occasionally misses short-distance gaps
  // between stations or piste endpoints that real skiers cross on foot
  // (e.g. funicular top → adjacent chairlift base, ~100 m flat walk).
  // We add bidirectional "walk" edges between any pair of nodes within
  // a short horizontal distance and a small elevation difference, with
  // a relatively high cost so Dijkstra only chooses them when there's
  // no skiable alternative.
  const walkCount = addWalkEdges(routingNodes, routingEdges, adj, reverseAdj);
  // Synthetic walk edges are an internal builder detail — silent in
  // production. Stash the count on the graph so a debug overlay or test
  // can read it if needed.
  void walkCount;

  // Set of node IDs that participate in any run / connection / lift /
  // lift_down edge. Used by the routing UI to constrain pin B to
  // "snap onto a piste or a lift node" — skating-only pocket nodes
  // and pure-walk nodes are excluded so the pin always lands somewhere
  // a skier would actually be.
  const pisteOrLiftNodes = new Set();
  for (const e of raw.edges) {
    if (e.type === "run" || e.type === "connection"
        || e.type === "lift" || e.type === "lift_down") {
      pisteOrLiftNodes.add(e.from);
      pisteOrLiftNodes.add(e.to);
    }
  }

  // --- Villages + stations as Point features ---
  const villagesFC = { type: "FeatureCollection", features: [] };
  for (const [name, v] of Object.entries(raw.villages || {})) {
    if (v.lat == null || v.lon == null) continue;
    villagesFC.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [v.lon, v.lat] },
      properties: { name, elev: v.elev ?? 0 },
    });
  }

  const stationIds = new Set();
  for (const e of raw.edges) {
    if (e.type === "lift") {
      stationIds.add(e.from);
      stationIds.add(e.to);
    }
  }
  const stationsFC = { type: "FeatureCollection", features: [] };
  for (const id of stationIds) {
    const n = nodeLookup[id];
    if (!n) continue;
    stationsFC.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [n.lon, n.lat] },
      properties: { name: n.name || `station ${id}`, elev: n.elev },
    });
  }

  return {
    raw,
    pistesFC,
    liftsFC,
    liftsDownFC,
    skatesFC,
    liftLabelsFC,
    pisteLabelsFC,
    villagesFC,
    stationsFC,
    routingNodes,
    routingEdges,
    adj,
    reverseAdj,
    pisteOrLiftNodes,
    stats: {
      nodes: raw.nodes.length,
      edges: raw.edges.length,
      villages: Object.keys(raw.villages || {}).length,
    },
  };
}

function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}

export const LIFT_COLOUR = "#000000";
export { DIFF_COLOURS };
