/**
 * Elevation profile for a routed path.
 *
 * Renders an inline SVG chart of altitude vs cumulative distance, with
 * segments coloured by edge type (piste difficulty / lift orange / walk
 * grey). Hovering the chart shows a tooltip and moves a synced marker
 * on the MapLibre map at the corresponding lat/lon. Strava / AllTrails
 * style.
 */

const DIFF_COLOURS = {
  novice:       "#00b050",
  easy:         "#1e88e5",
  intermediate: "#e53935",
  advanced:     "#2c2c2c",
  expert:       "#2c2c2c",
  freeride:     "#ff8800",
};
const LIFT_COLOUR  = "#ff6f00";
const SKATE_COLOUR = "#9aa3aa";
const WALK_COLOUR  = "#7c4dff";

// Chart dimensions: width matches the container (no horizontal scroll);
// height tracks the container too if it gives us one, otherwise a sane default.
const CHART_H_DEFAULT = 200;
const PAD = { top: 10, right: 10, bottom: 22, left: 38 };

let hoverMarker = null;
// Most-recent render args so the ResizeObserver can re-draw without
// requiring the caller to hold onto graph/path.
const _state = new WeakMap();

function edgeColour(edge) {
  if (edge.ty === "lift" || edge.ty === "lift_down") return LIFT_COLOUR;
  if (edge.ty === "skate") return SKATE_COLOUR;
  if (edge.ty === "walk")  return WALK_COLOUR;
  return DIFF_COLOURS[edge.d] || "#888";
}

function edgeLabel(edge) {
  const t = edge.ty;
  if (t === "lift")      return edge.n ? `${edge.n} (lift)` : "Lift";
  if (t === "lift_down") return edge.n ? `${edge.n} (down)` : "Lift down";
  if (t === "skate")     return "Skating link";
  if (t === "walk")      return edge.n || "Walk";
  if (t === "run" || t === "connection") {
    const diff = edge.d ? edge.d.charAt(0).toUpperCase() + edge.d.slice(1) : "";
    return edge.n ? `${edge.n}${diff ? ` (${diff})` : ""}` : (diff || "Run");
  }
  return edge.ty;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Build a dense set of profile points: for every coordinate inside every
 * edge's geometry, sample the actual DEM elevation when available, so
 * pistes show their real undulations instead of a straight slope from
 * top-node to bottom-node. Falls back to linear interpolation when the
 * DEM isn't loaded yet, or for lift edges (lifts go in a straight line
 * through the air — DEM under them is ground, not the cable height).
 *
 * Returns [{ d, e, lon, lat, ei, edge }] where d=cumulative distance (m),
 * e=elevation (m), ei=edge index.
 */
function buildProfile(graph, path) {
  // Optional DEM sampler exposed by sun.js once the shadow DEM is loaded.
  const dem = (typeof window !== "undefined") ? window._shadowDem : null;
  const sampleDEM = (dem && dem.dem && typeof dem.sampleElevation === "function")
    ? (lat, lon) => dem.sampleElevation(lat, lon)
    : null;

  const points = [];
  let cumDist = 0;

  for (let i = 0; i < path.length; i++) {
    const ei = path[i];
    const edge = graph.routingEdges[ei];
    const startElev = graph.routingNodes[edge.f][2];
    const endElev   = graph.routingNodes[edge.t][2];
    const geom = edge.g;
    const isLift = edge.ty === "lift" || edge.ty === "lift_down";
    const useDEM = !!sampleDEM && !isLift;

    let edgeLen = 0;
    for (let j = 1; j < geom.length; j++) {
      edgeLen += haversine(geom[j-1][0], geom[j-1][1], geom[j][0], geom[j][1]);
    }
    if (edgeLen === 0) edgeLen = 1;

    if (i === 0) {
      points.push({
        d: cumDist, e: startElev,
        lat: geom[0][0], lon: geom[0][1],
        ei, edge,
      });
    }

    let segCum = 0;
    for (let j = 1; j < geom.length; j++) {
      const segLen = haversine(geom[j-1][0], geom[j-1][1], geom[j][0], geom[j][1]);
      segCum += segLen;
      const frac = segCum / edgeLen;
      cumDist += segLen;

      let elev;
      if (j === geom.length - 1) {
        // Last point of the edge — keep the node elevation so adjacent
        // edges line up cleanly at the join.
        elev = endElev;
      } else if (useDEM) {
        const sampled = sampleDEM(geom[j][0], geom[j][1]);
        // Sanity-cap: huge deltas mean the DEM missed (out of bbox /
        // partial load) — fall back to interpolation in that case.
        if (sampled != null && Math.abs(sampled - startElev) < 600 &&
            Math.abs(sampled - endElev) < 600) {
          elev = sampled;
        } else {
          elev = startElev + (endElev - startElev) * frac;
        }
      } else {
        elev = startElev + (endElev - startElev) * frac;
      }

      points.push({
        d: cumDist, e: elev,
        lat: geom[j][0], lon: geom[j][1],
        ei, edge,
      });
    }
  }
  return points;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

/**
 * Render the chart into `container` (an empty <div>) and wire hover to
 * `map`. Returns a `dispose()` function that clears everything.
 *
 * Renders at the container's actual pixel width so text inside the SVG
 * stays at its native size (no aspect-ratio stretching). A ResizeObserver
 * triggers a re-draw when the container's width changes — important
 * because the elevation tab starts at width=0 (display:none) and only
 * gets its real width when the user switches to it.
 */
export function renderElevationProfile(container, map, graph, path) {
  // Cache for later re-renders (tab activation, window resize, DEM-ready).
  _state.set(container, { map, graph, path });

  // Expose a refresh hook so sun.js can trigger a redraw when the DEM
  // finishes loading. Idempotent — always points at the most recent
  // container we rendered into.
  window._refreshElevation = () => {
    const s = _state.get(container);
    if (s) drawChart(container, s.map, s.graph, s.path);
  };

  // Attach a ResizeObserver once per container. Redraw on either
  // width or height change so the chart fills whatever box we get.
  if (!container._elevObs) {
    let lastW = -1, lastH = -1;
    container._elevObs = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w < 100) return;
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      const s = _state.get(container);
      if (s) drawChart(container, s.map, s.graph, s.path);
    });
    container._elevObs.observe(container);
  }
  drawChart(container, map, graph, path);
  return () => disposeElevationProfile(container);
}

function drawChart(container, map, graph, path) {
  container.innerHTML = "";
  container.hidden = false;

  const points = buildProfile(graph, path);
  if (points.length < 2) { container.hidden = true; return () => {}; }

  const maxDist = points[points.length - 1].d;
  let minE = Infinity, maxE = -Infinity;
  for (const p of points) {
    if (p.e < minE) minE = p.e;
    if (p.e > maxE) maxE = p.e;
  }
  const elevSpan = maxE - minE || 50;
  const elevPad  = elevSpan * 0.1;
  const eLo = minE - elevPad, eHi = maxE + elevPad;

  // Compute total up/down for the meta row
  let totalUp = 0, totalDown = 0;
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].e - points[i - 1].e;
    if (delta > 0) totalUp += delta; else totalDown -= delta;
  }
  let metaHtml = `<div class="meta">`
    + `<span>↑ ${Math.round(totalUp)} m</span>`
    + `<span>↓ ${Math.round(totalDown)} m</span>`
    + `<span>${maxDist < 1000 ? Math.round(maxDist) + " m" : (maxDist / 1000).toFixed(1) + " km"}</span>`
    + `<span>${points.length - 1} legs</span>`
    + `<span class="route-dot">● route</span>`
    + `</div>`;

  // Render at the container's REAL pixel size so text inside the SVG
  // isn't stretched AND nothing overflows. Subtract the .elev-pane
  // padding (set in CSS as 14/12/18 px) — leave a small margin so the
  // SVG fits cleanly inside the rounded border.
  const cw = container.clientWidth  || 600;
  const ch = container.clientHeight || CHART_H_DEFAULT;
  const PAD_H = 28;   // matches .elev-pane horizontal padding
  const PAD_V = 32;   // top + bottom padding + room for meta row
  const W = Math.max(180, cw - PAD_H);
  const H = Math.max(120, Math.min(CHART_H_DEFAULT, ch - PAD_V));
  const xs = (d) => PAD.left + (d / maxDist) * (W - PAD.left - PAD.right);
  const ys = (e) => H - PAD.bottom - ((e - eLo) / (eHi - eLo)) * (H - PAD.top - PAD.bottom);

  let svg = metaHtml + `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" `
          + `style="display:block">`;

  // Y-axis grid lines every ~250m, rounded to nearest 100
  const gridStep = elevSpan > 1500 ? 500 : elevSpan > 600 ? 250 : 100;
  const firstGrid = Math.ceil(eLo / gridStep) * gridStep;
  for (let g = firstGrid; g < eHi; g += gridStep) {
    const y = ys(g);
    svg += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" `
         + `stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
    svg += `<text x="${PAD.left - 4}" y="${y + 3}" text-anchor="end" `
         + `font-size="10" fill="#7a8088" font-family="ui-monospace,monospace">${g}m</text>`;
  }

  // X-axis km labels
  const kmStep = maxDist > 10000 ? 2000 : maxDist > 4000 ? 1000 : 500;
  for (let d = 0; d <= maxDist; d += kmStep) {
    const x = xs(d);
    svg += `<line x1="${x}" y1="${H - PAD.bottom}" x2="${x}" y2="${H - PAD.bottom + 3}" `
         + `stroke="#7a8088" stroke-width="1"/>`;
    const label = d >= 1000 ? `${(d / 1000).toFixed(d % 1000 === 0 ? 0 : 1)} km` : `${d}m`;
    svg += `<text x="${x}" y="${H - 6}" text-anchor="middle" `
         + `font-size="10" fill="#7a8088" font-family="ui-monospace,monospace">${label}</text>`;
  }

  // Filled area under the profile (subtle yellow tint)
  let areaPath = `M ${xs(0)} ${H - PAD.bottom}`;
  for (const p of points) areaPath += ` L ${xs(p.d).toFixed(2)} ${ys(p.e).toFixed(2)}`;
  areaPath += ` L ${xs(maxDist)} ${H - PAD.bottom} Z`;
  svg += `<path d="${areaPath}" fill="rgba(255,224,0,0.08)" stroke="none"/>`;

  // Coloured line segments per edge type
  let curColour = edgeColour(points[1].edge);
  let curPath = `M ${xs(points[0].d).toFixed(2)} ${ys(points[0].e).toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    const c = edgeColour(points[i].edge);
    if (c !== curColour) {
      svg += `<path d="${curPath}" fill="none" stroke="${curColour}" `
           + `stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      curPath = `M ${xs(points[i-1].d).toFixed(2)} ${ys(points[i-1].e).toFixed(2)}`;
      curColour = c;
    }
    curPath += ` L ${xs(points[i].d).toFixed(2)} ${ys(points[i].e).toFixed(2)}`;
  }
  svg += `<path d="${curPath}" fill="none" stroke="${curColour}" `
       + `stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;

  // Hover cursor (initially hidden)
  svg += `<line id="elev-cursor-line" x1="0" y1="${PAD.top}" x2="0" y2="${H - PAD.bottom}" `
       + `stroke="rgba(255,255,255,0.7)" stroke-width="1" stroke-dasharray="3,3" `
       + `style="display:none;pointer-events:none"/>`;
  svg += `<circle id="elev-cursor-dot" r="4" fill="#ffe000" stroke="#000" stroke-width="1.5" `
       + `style="display:none;pointer-events:none"/>`;

  // Transparent overlay for capturing mouse events. preserveAspectRatio
  // is `none` so cursor x maps directly to viewBox x.
  svg += `<rect x="${PAD.left}" y="${PAD.top}" `
       + `width="${W - PAD.left - PAD.right}" height="${H - PAD.top - PAD.bottom}" `
       + `fill="transparent" id="elev-hover-rect"/>`;

  svg += `</svg>`;
  svg += `<div id="elev-tooltip" hidden></div>`;
  container.innerHTML = svg;

  // ───────── Hover interaction ─────────

  const svgEl = container.querySelector("svg");
  const cursorLine = container.querySelector("#elev-cursor-line");
  const cursorDot  = container.querySelector("#elev-cursor-dot");
  const tooltip    = container.querySelector("#elev-tooltip");
  const hoverRect  = container.querySelector("#elev-hover-rect");

  function nearestPointTo(viewBoxX) {
    // Binary search would be nicer but linear is fine for ~50–300 points
    const targetDist = ((viewBoxX - PAD.left) / (W - PAD.left - PAD.right)) * maxDist;
    let best = points[0], bestDelta = Math.abs(points[0].d - targetDist);
    for (let i = 1; i < points.length; i++) {
      const d = Math.abs(points[i].d - targetDist);
      if (d < bestDelta) { best = points[i]; bestDelta = d; }
    }
    return best;
  }

  function onMove(ev) {
    const rect = svgEl.getBoundingClientRect();
    const xPx = ev.clientX - rect.left;
    // Convert pixel-x to viewBox-x
    const xView = (xPx / rect.width) * W;
    const p = nearestPointTo(xView);

    cursorLine.setAttribute("x1", xs(p.d));
    cursorLine.setAttribute("x2", xs(p.d));
    cursorLine.style.display = "";
    cursorDot.setAttribute("cx", xs(p.d));
    cursorDot.setAttribute("cy", ys(p.e));
    cursorDot.style.display = "";

    // Map marker
    if (!hoverMarker) {
      const el = document.createElement("div");
      el.className = "elev-map-marker";
      hoverMarker = new maplibregl.Marker({ element: el })
        .setLngLat([p.lon, p.lat])
        .addTo(map);
    } else {
      hoverMarker.setLngLat([p.lon, p.lat]);
    }

    // Tooltip — pin to the right or left of cursor depending on space
    const distKm  = (p.d / 1000).toFixed(p.d < 1000 ? 2 : 1);
    const elev    = Math.round(p.e);
    const label   = edgeLabel(p.edge);
    tooltip.innerHTML =
      `<div class="elev-tt-dist">${distKm} km · ${elev} m</div>` +
      `<div class="elev-tt-name" style="border-left:3px solid ${edgeColour(p.edge)}">${escapeHtml(label)}</div>`;
    tooltip.hidden = false;
    const ttRect = tooltip.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    let left = xPx + 12;
    if (left + ttRect.width > containerRect.width - 4) left = xPx - 12 - ttRect.width;
    tooltip.style.left = `${Math.max(4, left)}px`;
    tooltip.style.top  = `4px`;
  }

  function onLeave() {
    cursorLine.style.display = "none";
    cursorDot.style.display  = "none";
    tooltip.hidden = true;
    if (hoverMarker) { hoverMarker.remove(); hoverMarker = null; }
  }

  hoverRect.addEventListener("mousemove", onMove);
  hoverRect.addEventListener("mouseleave", onLeave);
  // Touch
  hoverRect.addEventListener("touchmove", (e) => {
    if (e.touches && e.touches[0]) onMove(e.touches[0]);
  }, { passive: true });
  hoverRect.addEventListener("touchend", onLeave);

  return function dispose() {
    if (hoverMarker) { hoverMarker.remove(); hoverMarker = null; }
    container.innerHTML = "";
    container.hidden = true;
  };
}

export function disposeElevationProfile(container) {
  if (hoverMarker) { hoverMarker.remove(); hoverMarker = null; }
  if (container) {
    if (container._elevObs) {
      container._elevObs.disconnect();
      delete container._elevObs;
    }
    _state.delete(container);
    container.innerHTML = "";
    container.hidden = true;
  }
}
