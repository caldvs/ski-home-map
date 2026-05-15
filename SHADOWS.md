# Sun shadows — implementation notes

Visual shadows come from [ShadeMap](https://shademap.app/) (npm: `mapbox-gl-shadow-simulator`). This file captures the issues we hit getting it to work with MapLibre's 3D terrain mode, and what each setting does. Useful next time the integration breaks or upstream changes.

## Architecture

- **`js/sun.js`** wires the layer. Creates one `ShadeMap` instance bound to the active MapLibre map; toggled via the Shadows layer checkbox; date driven by the TimeScrubber.
- **`js/shadow-layer.js`** still exists but its WebGL render path is dead code. Only `setBbox()` + `sampleElevation()` are live — `elevation.js` calls them via `window._shadeDem` to get per-pixel elevation along route legs. (Strip in a follow-up.)
- **API key**: lives in `env.local` as `SUNSHADE_API_KEY` and mirrored to `js/config.local.js` as `SHADEMAP_API_KEY`. Both gitignored. For deploy, replicate the earlier `config.js` + workflow-secret pattern (see commit `acecd78` for the prior plumbing).
- **DEM source**: Mapterhorn (`tiles.mapterhorn.com/{z}/{x}/{y}.webp`), same origin MapLibre's 3D terrain source uses → tiles for the visible viewport are already in the browser HTTP cache when ShadeMap requests them.

## Issues we hit, in order

### 1. ShadeMap renders shadows only for `map.getBounds()` — which is smaller than the visible viewport at pitch > 0

ShadeMap's internal `_getBounds()` falls back to `map.getBounds()` when its `getSize` option returns `NaN` (the default). MapLibre's `getBounds()` returns the AABB of the visible corners — at pitch > 0 the trapezoid extends further than that AABB, so the corners of the screen end up *outside* the shaded region and show unshadowed terrain.

**Fix**: provide a custom `getSize` in the constructor. ShadeMap then computes bounds as `center ± (width/2, height/2)` pixels at the DEM zoom, which we make big enough to engulf the pitch-extended viewport.

### 2. Default ShadeMap canvas is 2:1; bounds returned by `getBounds()` typically aren't, so the canvas inscribes a 2:1 box and leaves a stripe bare

We hit this when the bare region was a clean lat-aligned line at ~half the bounds latitude. The shadow render covered only the lower half of the bounds.

**Fix**: have `getSize` return a `width: 2 * side, height: side` pair so the bounds aspect matches the canvas. `side` is `max(canvasW, canvasH) × 3` to get plenty of headroom.

```js
getSize: () => {
  const cv = map.getCanvas();
  const side = Math.max(cv.clientWidth, cv.clientHeight) * 3;
  return { width: side * 2, height: side };
}
```

### 3. `_overzoom` defaults to 20 → ShadeMap renders the heightmap at zoom 15+ even though Mapterhorn maxes out at z13

`_heightMap.demZoom` was reporting 15 with `terrainSource.maxZoom: 13`. ShadeMap was trying to upsample DEM tiles past the source's real max, leaving gaps where requested tiles 404'd.

**Fix**: set `terrainSource._overzoom: 13` explicitly. After this, `demZoom` matches the source.

### 4. HTTP-queue contention on `tiles.mapterhorn.com`

The browser caps to ~6 concurrent connections per host. When MapLibre's 3D terrain and ShadeMap both fetch from `tiles.mapterhorn.com` simultaneously (especially during a pan), some requests get cancelled mid-flight. The cancelled tiles' areas never get computed into the shadow texture → bare patches at tile boundaries.

**Partial mitigations in place**:
- Same origin means ShadeMap's requests usually hit MapLibre's already-cached tiles in the browser HTTP cache, so the "second" fetch is instant and doesn't actually consume a connection.
- `movestart`-set / `idle`-cleared flag triggers `shadeMap.setDate(currentDate)` once the map quiesces, forcing ShadeMap to recompute over whatever's now loaded.

### 5. AWS terrarium DEM as an alternative origin — rejected

ShadeMap's docs suggest `s3.amazonaws.com/elevation-tiles-prod/terrarium/...`. Switching to that *did* sidestep the HTTP-queue contention because it's a different origin, but:
- Latency from Europe is high (us-east-1).
- Tiles are larger PNGs (~100 KB) vs Mapterhorn's webp (~30 KB).
- Net perf was noticeably worse.

We stayed on Mapterhorn.

## Settings, current values

In `js/sun.js`:

| Option | Value | Why |
|---|---|---|
| `apiKey` | from `js/config.local.js` | gitignored JWT |
| `date` | `currentDate` | TimeScrubber-driven |
| `color` | `#01112f` | cool blue, matches `--shadow` |
| `opacity` | `0.55` | tuned for basemap |
| `getSize` | `{w: side*2, h: side}` | aspect-match canvas + 3× headroom |
| `terrainSource.tileSize` | 512 | Mapterhorn tile dim |
| `terrainSource.maxZoom` | 13 | Mapterhorn real max |
| `terrainSource._overzoom` | 13 | cap heightmap demZoom too |

Plus `movestart` arms a flag, `idle` consumes it by calling `setDate(currentDate)` — forces ShadeMap to re-render once the map settles.

## Remaining limitations

- **Resolution**: the bigger we make `getSize`, the lower the per-pixel shadow resolution becomes (300×150 internal canvas spread across more lng/lat). At `× 3` × 2:1 aspect, shadow edges on close-up terrain look slightly chunky.
- **Coverage at extreme pitch (> 70°)**: `× 3` may still leave slivers if the viewport stretches further than that. Bumping to `× 4` or `× 5` works but compounds the resolution loss.
- **Tile-boundary bare patches during fast pans**: still possible if many fresh tiles need to load. The `idle` recompute usually catches it, but if the user starts a new pan before idle fires, the recompute resets.
- **No upstream control over the canvas aspect**: ShadeMap hard-codes 300×150. If they ever change that, our `getSize × 2:1` trick will produce mismatched aspect again.

## If we ever want to push further

- File an issue on `ted-piotrowski/mapbox-gl-shadow-simulator` for first-class pitch/terrain support (existing related issue: [#4](https://github.com/ted-piotrowski/mapbox-gl-shadow-simulator/issues/4) "Size of the shade area").
- Or fork it and make `getSize` accept a function returning `Bounds` directly, bypassing the canvas-aspect inscribe.
- Pre-warm Mapterhorn tiles for the planned move target on `easeTo` so the `idle` recompute always finds fully-loaded tiles.
