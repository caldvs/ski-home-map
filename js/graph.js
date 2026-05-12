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

export async function loadGraph(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load graph: ${resp.status} ${resp.statusText}`);
  return reshapeGraph(await resp.json());
}

function reshapeGraph(raw) {
  // --- Layer data: GeoJSON FeatureCollections ---
  const pistesFC = { type: "FeatureCollection", features: [] };
  const liftsFC = { type: "FeatureCollection", features: [] };
  const liftsDownFC = { type: "FeatureCollection", features: [] };
  const skatesFC = { type: "FeatureCollection", features: [] };

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

  const nodeById = (id) => raw.nodes.find((n) => n.id === id); // fallback; rarely needed

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
    villagesFC,
    stationsFC,
    routingNodes,
    routingEdges,
    adj,
    reverseAdj,
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

export const LIFT_COLOUR = "#ff6f00";
export { DIFF_COLOURS };
