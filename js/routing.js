/**
 * Browser-side routing: cost model, three algorithms (Dijkstra / A* /
 * bidirectional Dijkstra), click-to-pin handling, route rendering, and
 * the algorithm-exploration animation.
 *
 * Mirrors skiroute (Python) — the cost function and ordering are kept
 * in sync. Faithful but small; ~300 lines.
 */

const DIFFICULTY_PENALTY = {
  "prefer-easy": {
    novice: 0, easy: 0, intermediate: 600, advanced: 2000,
    expert: 5000, freeride: 5000,
  },
  "reds-if-needed": {
    novice: 0, easy: 0, intermediate: 60, advanced: 800,
    expert: 3000, freeride: 3000,
  },
  "any-piste": {
    novice: 0, easy: 0, intermediate: 0, advanced: 0,
    expert: 60, freeride: 120,
  },
};
const LIFT_DOWN_DISCOUNT = 420;

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
  if (mode === "prefer-easy" && edge.ty === "lift_down") c -= LIFT_DOWN_DISCOUNT;
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

export function nearestNodeId(graph, lat, lon) {
  let best = null, bestD = Infinity;
  for (const id in graph.routingNodes) {
    const n = graph.routingNodes[id];
    const dLat = n[1] - lat, dLon = n[0] - lon;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best === null ? null : parseInt(best, 10);
}

export function describeNode(graph, id) {
  const n = graph.routingNodes[id];
  return (n[3] || ("node " + id)) + " (" + Math.round(n[2]) + "m)";
}

export { DijkstraRunner, AstarRunner, BidirRunner, edgeCost };
