/**
 * Browser-side routing: cost model, three algorithms (Dijkstra / A* /
 * bidirectional Dijkstra), click-to-pin handling, route rendering, and
 * the algorithm-exploration animation.
 *
 * Mirrors skiroute (Python) — the cost function and ordering are kept
 * in sync. Faithful but small; ~300 lines.
 */

// Penalty added per run/connection edge by difficulty + mode. Lower
// numbers than before in prefer-easy: the previous +600 for reds was
// so aggressive that the algorithm preferred a downhill cable-car
// ride over a normal red piste descent. The user's intuition is that
// reds should still be skied even when "preferring easy" — they're
// the standard intermediate piste, not a hardship.
const DIFFICULTY_PENALTY = {
  "prefer-easy": {
    novice: 0, easy: 0, intermediate: 250, advanced: 1200,
    expert: 3000, freeride: 3000,
  },
  "reds-if-needed": {
    novice: 0, easy: 0, intermediate: 30, advanced: 600,
    expert: 2000, freeride: 2000,
  },
  "any-piste": {
    novice: 0, easy: 0, intermediate: 0, advanced: 0,
    expert: 60, freeride: 120,
  },
};

// Riding a lift downhill is a last-resort move — only acceptable when
// no skiable route exists between two pocket areas. The graph builder
// already gives lift_down edges a high base cost; we add a heavy fixed
// penalty here in EVERY mode so any reasonable piste descent wins.
// Tuned so a ~10-edge red route still beats a single lift-down ride,
// while a no-piste pocket can still force lift-down as the only path.
const LIFT_DOWN_PENALTY = 3500;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function edgeCost(edge, mode) {
  let c = edge.c;
  if (edge.d && (edge.ty === "run" || edge.ty === "connection")) {
    c += DIFFICULTY_PENALTY[mode][edge.d] || 0;
  }
  if (edge.ty === "lift_down") c += LIFT_DOWN_PENALTY;
  return c;
}

// ============================================================
// Algorithm step-runners (for both one-shot route + animation)
// ============================================================

class DijkstraRunner {
  constructor(src, tgt, mode, graph) {
    this.src = src; this.tgt = tgt; this.mode = mode; this.g = graph;
    this.dist = {}; this.dist[src] = 0;
    this.prev = {}; this.prevEdge = {};
    this.visited = new Set();
    this.heap = [[0, src]];
    this.iters = 0; this.done = false; this.foundPath = null;
  }
  step() {
    if (this.done) return null;
    while (this.heap.length) {
      this.heap.sort((a, b) => a[0] - b[0]);
      const [d, u] = this.heap.shift();
      if (this.visited.has(u)) continue;
      this.visited.add(u); this.iters++;
      if (u === this.tgt) {
        this.done = true;
        this.foundPath = reconstructFwd(this.prev, this.prevEdge, u);
        return { settled: u, direction: "fwd", meeting: false };
      }
      for (const eIdx of (this.g.adj[u] || [])) {
        const e = this.g.routingEdges[eIdx];
        if (this.visited.has(e.t)) continue;
        const nd = d + edgeCost(e, this.mode);
        if (nd < (this.dist[e.t] ?? Infinity)) {
          this.dist[e.t] = nd; this.prev[e.t] = u; this.prevEdge[e.t] = eIdx;
          this.heap.push([nd, e.t]);
        }
      }
      return { settled: u, direction: "fwd", meeting: false };
    }
    this.done = true;
    return null;
  }
}

class AstarRunner {
  constructor(src, tgt, mode, graph) {
    this.src = src; this.tgt = tgt; this.mode = mode; this.g = graph;
    this.gScore = {}; this.gScore[src] = 0;
    this.prev = {}; this.prevEdge = {};
    this.visited = new Set();
    const tn = graph.routingNodes[tgt];
    this.tgtLat = tn[1]; this.tgtLon = tn[0];
    this.h = (id) => {
      const n = graph.routingNodes[id];
      return haversine(n[1], n[0], this.tgtLat, this.tgtLon) / 8.0;
    };
    this.heap = [[this.h(src), src]];
    this.iters = 0; this.done = false; this.foundPath = null;
  }
  step() {
    if (this.done) return null;
    while (this.heap.length) {
      this.heap.sort((a, b) => a[0] - b[0]);
      const [, u] = this.heap.shift();
      if (this.visited.has(u)) continue;
      this.visited.add(u); this.iters++;
      if (u === this.tgt) {
        this.done = true;
        this.foundPath = reconstructFwd(this.prev, this.prevEdge, u);
        return { settled: u, direction: "fwd", meeting: false };
      }
      const gu = this.gScore[u];
      for (const eIdx of (this.g.adj[u] || [])) {
        const e = this.g.routingEdges[eIdx];
        if (this.visited.has(e.t)) continue;
        const tentative = gu + edgeCost(e, this.mode);
        if (tentative < (this.gScore[e.t] ?? Infinity)) {
          this.gScore[e.t] = tentative;
          this.prev[e.t] = u; this.prevEdge[e.t] = eIdx;
          this.heap.push([tentative + this.h(e.t), e.t]);
        }
      }
      return { settled: u, direction: "fwd", meeting: false };
    }
    this.done = true;
    return null;
  }
}

class BidirRunner {
  constructor(src, tgt, mode, graph) {
    this.src = src; this.tgt = tgt; this.mode = mode; this.g = graph;
    this.fwdDist = { [src]: 0 }; this.fwdPrev = {}; this.fwdPrevEdge = {};
    this.fwdSettled = {}; this.fwdHeap = [[0, src]];
    this.bwdDist = { [tgt]: 0 }; this.bwdNext = {}; this.bwdNextEdge = {};
    this.bwdSettled = {}; this.bwdHeap = [[0, tgt]];
    this.bestCost = Infinity; this.meetingNode = null;
    this.iters = 0; this.done = false; this.foundPath = null;
  }
  cm(node, total) {
    if (total < this.bestCost) { this.bestCost = total; this.meetingNode = node; }
  }
  step() {
    if (this.done) return null;
    const fTop = this.fwdHeap.length ? this.fwdHeap[0][0] : Infinity;
    const bTop = this.bwdHeap.length ? this.bwdHeap[0][0] : Infinity;
    if (fTop + bTop >= this.bestCost) {
      this.done = true;
      if (this.meetingNode === null) return null;
      const a = []; let cur = this.meetingNode;
      while (this.fwdPrevEdge[cur] !== undefined) {
        a.push(this.fwdPrevEdge[cur]); cur = this.fwdPrev[cur];
      }
      a.reverse();
      const b = []; cur = this.meetingNode;
      while (this.bwdNextEdge[cur] !== undefined) {
        b.push(this.bwdNextEdge[cur]); cur = this.bwdNext[cur];
      }
      this.foundPath = a.concat(b);
      return null;
    }
    if (fTop <= bTop && this.fwdHeap.length) {
      this.fwdHeap.sort((a, b) => a[0] - b[0]);
      const [d, u] = this.fwdHeap.shift();
      if (u in this.fwdSettled) return { settled: -1, direction: "fwd", meeting: false };
      this.fwdSettled[u] = d; this.iters++;
      if (u in this.bwdDist) this.cm(u, d + this.bwdDist[u]);
      for (const eIdx of (this.g.adj[u] || [])) {
        const e = this.g.routingEdges[eIdx];
        if (e.t in this.fwdSettled) continue;
        const nd = d + edgeCost(e, this.mode);
        if (nd < (this.fwdDist[e.t] ?? Infinity)) {
          this.fwdDist[e.t] = nd; this.fwdPrev[e.t] = u; this.fwdPrevEdge[e.t] = eIdx;
          this.fwdHeap.push([nd, e.t]);
          if (e.t in this.bwdDist) this.cm(e.t, nd + this.bwdDist[e.t]);
        }
      }
      return { settled: u, direction: "fwd", meeting: u === this.meetingNode };
    } else if (this.bwdHeap.length) {
      this.bwdHeap.sort((a, b) => a[0] - b[0]);
      const [d, u] = this.bwdHeap.shift();
      if (u in this.bwdSettled) return { settled: -1, direction: "bwd", meeting: false };
      this.bwdSettled[u] = d; this.iters++;
      if (u in this.fwdDist) this.cm(u, this.fwdDist[u] + d);
      for (const eIdx of (this.g.reverseAdj[u] || [])) {
        const e = this.g.routingEdges[eIdx];
        const v = e.f;
        if (v in this.bwdSettled) continue;
        const nd = d + edgeCost(e, this.mode);
        if (nd < (this.bwdDist[v] ?? Infinity)) {
          this.bwdDist[v] = nd; this.bwdNext[v] = u; this.bwdNextEdge[v] = eIdx;
          this.bwdHeap.push([nd, v]);
          if (v in this.fwdDist) this.cm(v, this.fwdDist[v] + nd);
        }
      }
      return { settled: u, direction: "bwd", meeting: u === this.meetingNode };
    }
    this.done = true;
    return null;
  }
}

function reconstructFwd(prev, prevEdge, u) {
  const path = []; let cur = u;
  while (prevEdge[cur] !== undefined) {
    path.push(prevEdge[cur]); cur = prev[cur];
  }
  return path.reverse();
}

// ============================================================
// One-shot Dijkstra for interactive routing (the snappy path)
// ============================================================

export function runDijkstra(srcId, tgtId, mode, graph) {
  const dist = { [srcId]: 0 };
  const prev = {}, prevEdge = {};
  const visited = new Set();
  const heap = [[0, srcId]];
  let iters = 0;
  while (heap.length) {
    heap.sort((a, b) => a[0] - b[0]);
    const [d, u] = heap.shift();
    if (visited.has(u)) continue;
    visited.add(u); iters++;
    if (u === tgtId) {
      return { path: reconstructFwd(prev, prevEdge, u), totalSeconds: d, visited: iters };
    }
    for (const eIdx of (graph.adj[u] || [])) {
      const e = graph.routingEdges[eIdx];
      if (visited.has(e.t)) continue;
      const nd = d + edgeCost(e, mode);
      if (nd < (dist[e.t] ?? Infinity)) {
        dist[e.t] = nd; prev[e.t] = u; prevEdge[e.t] = eIdx;
        heap.push([nd, e.t]);
      }
    }
  }
  return { path: null, totalSeconds: null, visited: iters };
}

// Count how many distinct nodes a Dijkstra-style traversal starting at
// `srcId` can reach. Pass `reverse: true` to count nodes that can reach
// `srcId` instead. Used to diagnose "no route" failures and tell the user
// whether the problem is the start, the end, or just a missing one-way
// edge between two well-connected regions.
export function reachableCount(graph, srcId, opts = {}) {
  const reverse = !!opts.reverse;
  const limit = opts.limit ?? Infinity;
  const seen = new Set([srcId]);
  const stack = [srcId];
  while (stack.length && seen.size < limit) {
    const u = stack.pop();
    const list = reverse ? (graph.reverseAdj[u] || []) : (graph.adj[u] || []);
    for (const eIdx of list) {
      const e = graph.routingEdges[eIdx];
      const v = reverse ? e.f : e.t;
      if (!seen.has(v)) { seen.add(v); stack.push(v); }
    }
  }
  return seen.size;
}

export function nearestNodeId(graph, lat, lon, filter) {
  let best = null, bestD = Infinity;
  for (const id in graph.routingNodes) {
    if (filter && !filter(parseInt(id, 10))) continue;
    const n = graph.routingNodes[id];
    const dLat = n[1] - lat, dLon = n[0] - lon;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best === null ? null : parseInt(best, 10);
}

// Convenience: pin B must land on a piste / lift / connection / lift_down
// node, never a skating-only pocket node.
export function nearestPisteOrLiftNodeId(graph, lat, lon) {
  const filter = graph.pisteOrLiftNodes
    ? (nid) => graph.pisteOrLiftNodes.has(nid)
    : null;
  return nearestNodeId(graph, lat, lon, filter);
}

// Project (lat, lon) onto the nearest piste / lift / connection /
// lift_down edge. Returns the projection point + routing endpoint +
// the "approach geometry" — the portion of the edge from the
// projection along the line to the chosen endpoint. The yellow
// route line is prepended with this approach so it visually starts
// at the projection (where the dashed perpendicular bridge ends).
//
// For pistes / connections: always pick e.t (downhill end). The
// approach traces from the projection point down the rest of the
// piste to its bottom.
// For lifts / lift_down: pick whichever endpoint the projection is
// closer to — usually the bottom station the user just exited.
//
// Scoring isn't pure 2D distance: a piste that's a bit further but
// horizontal-or-downhill is preferred over a closer one that's uphill
// (no-one in a snowfield walks back up to a piste). The uphill penalty
// is BOUNDED — we never go more than a fixed extra horizontal budget
// to avoid uphill, so a click in a snowfield ringed by uphill pistes
// still snaps to one of them rather than running off to a far-away
// gondola just because that one happens to be downhill.
//
// Returns:
//   { edgeIdx, projLat, projLon, nodeId,
//     approachGeom: [[lat, lon], ...]   // starts at projection,
//                                       // ends at routingNodes[nodeId]
//     distance }
// or null if no edge geometry was usable.
export function nearestPisteLineProjection(graph, lat, lon) {
  const RUNS_LIFTS = new Set(["run", "connection", "lift", "lift_down"]);

  // Click-elevation: prefer the real DEM if it has been streamed in,
  // otherwise fall back to the nearest routing node's elevation. The
  // DEM gives the click point's actual terrain height (correct even
  // mid-snowfield); the node fallback is a coarser proxy.
  let userElev = null;
  if (typeof window !== "undefined" && window._shadowDem
      && typeof window._shadowDem.sampleElevation === "function") {
    const e = window._shadowDem.sampleElevation(lat, lon);
    if (Number.isFinite(e)) userElev = e;
  }
  if (userElev == null) {
    let nearestD2 = Infinity;
    for (let i = 0; i < graph.routingNodes.length; i++) {
      const n = graph.routingNodes[i];
      const dLat = n[1] - lat, dLon = n[0] - lon;
      const d2 = dLat * dLat + dLon * dLon;
      if (d2 < nearestD2) { nearestD2 = d2; userElev = n[2]; }
    }
  }

  // Equirectangular metres-per-degree at this latitude — used to put
  // horizontal distance and elevation gain on the same scale.
  const M_PER_DEG_LAT = 111320;
  const M_PER_DEG_LON = 111320 * Math.cos(lat * Math.PI / 180);

  // Uphill penalty: 25 m of effective walking per metre of climb, but
  // bounded so a click ringed entirely by uphill pistes still snaps to
  // the closest one rather than running off to a far-away downhill
  // gondola. No downhill bonus — the goal is "nearest tarmac, just
  // don't make me walk up", not "find the lowest piste on the mountain".
  const UPHILL_M_PER_M = 25;
  const MAX_UPHILL_PENALTY_M = 120;

  // Score one candidate snap point against the running best.
  function consider(ei, e, pLat, pLon, segIdx, t, wholeT, projElev) {
    const dxM = (pLon - lon) * M_PER_DEG_LON;
    const dyM = (pLat - lat) * M_PER_DEG_LAT;
    const horizM = Math.sqrt(dxM * dxM + dyM * dyM);
    const dh = projElev - userElev;
    const uphillPenalty = dh > 0
      ? Math.min(MAX_UPHILL_PENALTY_M, dh * UPHILL_M_PER_M) : 0;
    const score = horizM + uphillPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = {
        edgeIdx: ei, edge: e,
        projLat: pLat, projLon: pLon,
        segIdx, t, wholeT,
        distance: horizM,
      };
    }
  }

  let best = null;
  let bestScore = Infinity;
  const edges = graph.routingEdges;
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    if (!RUNS_LIFTS.has(e.ty)) continue;
    const g = e.g;
    if (!g || g.length < 2) continue;
    const elevF = graph.routingNodes[e.f][2];
    const elevT = graph.routingNodes[e.t][2];
    const isLift = e.ty === "lift" || e.ty === "lift_down";

    if (isLift) {
      // Lifts can only be boarded at their stations — never mid-cable.
      // Consider only the bottom (f) and top (t) endpoint coordinates;
      // the routing layer decides whether the user goes up or down based
      // on which edges are available out of that station.
      const fLon = graph.routingNodes[e.f][0];
      const fLat = graph.routingNodes[e.f][1];
      const tLon = graph.routingNodes[e.t][0];
      const tLat = graph.routingNodes[e.t][1];
      consider(ei, e, fLat, fLon, 1,           0, 0, elevF);
      consider(ei, e, tLat, tLon, g.length - 1, 1, 1, elevT);
      continue;
    }

    // Pistes / connections — project onto every segment of the line.
    // Skiers can enter a piste anywhere along its length by skiing in
    // from the surrounding snowfield.
    for (let i = 1; i < g.length; i++) {
      const aLat = g[i-1][0], aLon = g[i-1][1];
      const bLat = g[i][0],   bLon = g[i][1];
      const dLat = bLat - aLat, dLon = bLon - aLon;
      const len2 = dLat * dLat + dLon * dLon;
      let t = 0;
      if (len2 > 0) {
        t = ((lat - aLat) * dLat + (lon - aLon) * dLon) / len2;
        t = Math.max(0, Math.min(1, t));
      }
      const pLat = aLat + t * dLat;
      const pLon = aLon + t * dLon;
      const wholeT = (i - 1 + t) / (g.length - 1);
      const projElev = elevF + (elevT - elevF) * wholeT;
      consider(ei, e, pLat, pLon, i, t, wholeT, projElev);
    }
  }
  if (!best) return null;

  const e = best.edge;
  const g = e.g;
  // Pick the routing endpoint per edge type.
  const isLift = e.ty === "lift" || e.ty === "lift_down";
  const goToEnd = isLift ? best.wholeT >= 0.5 : true;  // pistes → always e.t
  const nodeId = goToEnd ? e.t : e.f;

  // Build approach geometry from the projection point along the edge
  // toward the chosen endpoint. For lifts the projection IS the station
  // (we never mid-cable-snap), so the approach is just that point — the
  // route line takes over from the station onward.
  const approach = [[best.projLat, best.projLon]];
  if (!isLift) {
    if (goToEnd) {
      for (let i = best.segIdx; i < g.length; i++) {
        const c = g[i];
        const prev = approach[approach.length - 1];
        if (Math.abs(c[0] - prev[0]) > 1e-9 || Math.abs(c[1] - prev[1]) > 1e-9) {
          approach.push([c[0], c[1]]);
        }
      }
    } else {
      for (let i = best.segIdx - 1; i >= 0; i--) {
        const c = g[i];
        const prev = approach[approach.length - 1];
        if (Math.abs(c[0] - prev[0]) > 1e-9 || Math.abs(c[1] - prev[1]) > 1e-9) {
          approach.push([c[0], c[1]]);
        }
      }
    }
  }

  return {
    edgeIdx: best.edgeIdx,
    projLat: best.projLat,
    projLon: best.projLon,
    nodeId,
    approachGeom: approach,
    distance: best.distance,
  };
}

export function describeNode(graph, id) {
  const n = graph.routingNodes[id];
  return (n[3] || ("node " + id)) + " (" + Math.round(n[2]) + "m)";
}

export { DijkstraRunner, AstarRunner, BidirRunner, edgeCost };
