/**
 * Custom shadow layer for MapLibre.
 *
 * Loads a stitched DEM texture for a resort bbox (+ buffer), then
 * ray-marches per pixel toward the sun in a fragment shader. Output:
 * a soft dark fill where the ray hits terrain before reaching the
 * sky. Continuous (no tile seams), GPU-accelerated, no external API.
 *
 * Usage:
 *     const layer = new ShadowLayer({ opacity: 0.45 });
 *     map.addLayer(layer);
 *     await layer.loadDEM({ minLon, minLat, maxLon, maxLat }, { bufferKm: 12 });
 *     layer.setSun(azimuth, altitude);   // updates whenever sun moves
 */

const TILE_SIZE = 512;
const DEM_ZOOM = 11;          // ~9.6 km / tile at z11; terrarium pixel ≈ 19 m
const DEFAULT_BUFFER_KM = 12; // peaks within this radius cast into the bbox

// Web-Mercator helpers (lat/lon → tile coords at zoom z) ------------------

function lon2tx(lon, z) {
  return ((lon + 180) / 360) * (1 << z);
}
function lat2ty(lat, z) {
  const r = (lat * Math.PI) / 180;
  return (
    (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z)
  );
}
function tx2lon(tx, z) {
  return (tx / (1 << z)) * 360 - 180;
}
function ty2lat(ty, z) {
  const n = Math.PI - (2 * Math.PI * ty) / (1 << z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
// MapLibre's normalized Mercator coords (0..1 across the world)
function mercX(lon)  { return (lon + 180) / 360; }
function mercY(lat)  {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
}


// DEM loader ---------------------------------------------------------------

/**
 * Fetches Mapterhorn DEM tiles covering `bbox` + buffer, draws them
 * into a single offscreen canvas, returns the stitched canvas and the
 * geographic bbox the canvas actually covers (aligned to tile edges).
 */
export async function loadDEM(bbox, opts = {}) {
  const bufferKm = opts.bufferKm ?? DEFAULT_BUFFER_KM;
  // Convert buffer-km to a buffer in tile counts at z=DEM_ZOOM.
  // At z=11 a single tile is ~9.6 km wide → ceil(bufferKm / 9.6) tiles.
  const tileWidthKm = (40075 * Math.cos((bbox.minLat + bbox.maxLat) * 0.5 * Math.PI / 180)) / (1 << DEM_ZOOM);
  const bufferTiles = Math.max(1, Math.ceil(bufferKm / tileWidthKm));

  const tx0 = Math.floor(lon2tx(bbox.minLon, DEM_ZOOM)) - bufferTiles;
  const tx1 = Math.floor(lon2tx(bbox.maxLon, DEM_ZOOM)) + bufferTiles;
  const ty0 = Math.floor(lat2ty(bbox.maxLat, DEM_ZOOM)) - bufferTiles;
  const ty1 = Math.floor(lat2ty(bbox.minLat, DEM_ZOOM)) + bufferTiles;

  const widthTiles  = tx1 - tx0 + 1;
  const heightTiles = ty1 - ty0 + 1;

  const canvas = document.createElement("canvas");
  canvas.width  = widthTiles  * TILE_SIZE;
  canvas.height = heightTiles * TILE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });

  // Load every tile in parallel.
  const loads = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const px = (tx - tx0) * TILE_SIZE;
      const py = (ty - ty0) * TILE_SIZE;
      loads.push(loadTile(tx, ty, DEM_ZOOM).then((img) => {
        if (img) ctx.drawImage(img, px, py, TILE_SIZE, TILE_SIZE);
      }));
    }
  }
  await Promise.all(loads);

  // The stitched canvas covers (tx0..tx1+1, ty0..ty1+1) in tile units
  // — convert that back to a geographic bbox.
  const stitchedBbox = {
    minLon: tx2lon(tx0,      DEM_ZOOM),
    maxLon: tx2lon(tx1 + 1,  DEM_ZOOM),
    maxLat: ty2lat(ty0,      DEM_ZOOM),
    minLat: ty2lat(ty1 + 1,  DEM_ZOOM),
  };

  // Approximate physical size of the stitched area in metres, for
  // converting "step distance in metres" to "step in DEM uv".
  const midLat = (stitchedBbox.minLat + stitchedBbox.maxLat) / 2;
  const widthM  = (stitchedBbox.maxLon - stitchedBbox.minLon) * 111320 * Math.cos(midLat * Math.PI / 180);
  const heightM = (stitchedBbox.maxLat - stitchedBbox.minLat) * 110540;

  // Sample a small grid to find the max elevation — used as a ray-march
  // bail-out (if the ray is above max-elev there's nothing to occlude it).
  const maxElev = sampleMaxElev(canvas, ctx);

  return {
    canvas,
    bbox: stitchedBbox,
    widthM,
    heightM,
    maxElev,
    tilesLoaded: loads.length,
  };
}

function loadTile(tx, ty, z) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null); // soft fail — gaps tolerated
    img.src = `https://tiles.mapterhorn.com/${z}/${tx}/${ty}.webp`;
  });
}

function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

function sampleMaxElev(canvas, ctx) {
  // Read a downscaled version to keep this cheap.
  const SCALE = 8;
  const w = Math.max(2, Math.floor(canvas.width / SCALE));
  const h = Math.max(2, Math.floor(canvas.height / SCALE));
  const small = document.createElement("canvas");
  small.width = w; small.height = h;
  small.getContext("2d").drawImage(canvas, 0, 0, w, h);
  const data = small.getContext("2d").getImageData(0, 0, w, h).data;
  let max = -Infinity;
  for (let i = 0; i < data.length; i += 4) {
    const e = decodeTerrarium(data[i], data[i + 1], data[i + 2]);
    if (e > max) max = e;
  }
  return max;
}


// Shader sources -----------------------------------------------------------

const VERT = `
attribute vec2 a_merc;
attribute vec2 a_uv;
uniform mat4  u_matrix;
varying vec2  v_uv;
void main() {
  gl_Position = u_matrix * vec4(a_merc, 0.0, 1.0);
  v_uv = a_uv;
}`;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_dem;
uniform vec3 u_sunStep;   // per-step delta: (du, dv, delev_m)
uniform float u_stepCount;
uniform float u_maxElev;
uniform vec4 u_color;     // shadow rgba
uniform int u_debugMode;  // 0 = shadow, 1 = solid red quad, 2 = DEM elev

float decodeElev(vec3 rgb) {
  // terrarium: (R*256 + G + B/256) - 32768, where channels are 0..255
  return rgb.r * 65280.0 + rgb.g * 255.0 + rgb.b * 0.99609375 - 32768.0;
}

void main() {
  if (u_debugMode == 1) {
    gl_FragColor = vec4(1.0, 0.0, 0.0, 0.5);
    return;
  }
  if (u_debugMode == 2) {
    float e = decodeElev(texture2D(u_dem, v_uv).rgb);
    float g = clamp(e / 3500.0, 0.0, 1.0);
    gl_FragColor = vec4(g, g, g, 0.7);
    return;
  }
  if (v_uv.x < 0.0 || v_uv.x > 1.0 || v_uv.y < 0.0 || v_uv.y > 1.0) discard;

  // Binary cast-shadow ray-march.
  float startElev = decodeElev(texture2D(u_dem, v_uv).rgb);
  vec2 uv = v_uv;
  float rayElev = startElev + 0.5;
  float occlude = 0.0;
  for (int i = 0; i < 512; i++) {
    if (float(i) >= u_stepCount) break;
    uv      += u_sunStep.xy;
    rayElev += u_sunStep.z;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    if (rayElev > u_maxElev) break;
    float terrain = decodeElev(texture2D(u_dem, uv).rgb);
    if (terrain > rayElev) { occlude = 1.0; break; }
  }
  if (occlude <= 0.0) discard;
  gl_FragColor = u_color;
}`;


// Custom layer -------------------------------------------------------------

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("Shadow shader compile failed: " + log);
  }
  return sh;
}

export class ShadowLayer {
  constructor(opts = {}) {
    this.id   = opts.id || "custom-shadow";
    this.type = "custom";
    this.renderingMode = "2d";

    this.opacity   = opts.opacity ?? 0.55;
    this.colorRgb  = opts.color   || [0.01, 0.04, 0.16]; // deep cool blue
    this.stepM     = opts.stepM   || 18;   // ray-march step (metres)
    this.stepCount = opts.stepCount || 512;
    this.softness  = opts.softness  || 0;  // unused now — binary shadow

    this.dem        = null;
    this.azimuth    = 180;
    this.altitude   = 30;
    this._gl        = null;
    this._map       = null;
    this._program   = null;
    this._buf       = null;
    this._texture   = null;
    this._uniforms  = {};
    this._attribs   = {};
    this._demDirty  = false;
  }

  // Public API ------------------------------------------------------------

  async setBbox(bbox, opts) {
    this.dem = await loadDEM(bbox, opts);
    this._demDirty = true;
    // Drop any cached pixel buffer so the next sampleElevation() picks
    // up the new DEM.
    this._demImageData = null;
    this._buildQuad();
    if (this._map) this._map.triggerRepaint();
  }

  /**
   * Sample the stitched DEM at the given lat/lon. Returns elevation in
   * metres, or null if the point is outside the DEM bbox / not loaded
   * yet. Caches the ImageData on first call so subsequent reads are
   * just array indexing.
   */
  sampleElevation(lat, lon) {
    if (!this.dem || !this.dem.canvas) return null;
    const b = this.dem.bbox;
    if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) {
      return null;
    }
    if (!this._demImageData) {
      const c = this.dem.canvas;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      try {
        this._demImageData = ctx.getImageData(0, 0, c.width, c.height);
        this._demW = c.width;
        this._demH = c.height;
      } catch (e) {
        // Tainted canvas (rare with CORS-enabled tiles) — bail.
        return null;
      }
    }
    // Resort scale is small enough that lon/lat → uv linear mapping
    // matches Mercator within ~0.1 m at this latitude. Good enough.
    const u = (lon - b.minLon) / (b.maxLon - b.minLon);
    const v = (b.maxLat - lat) / (b.maxLat - b.minLat);
    const px = Math.min(this._demW - 1, Math.max(0, Math.floor(u * (this._demW - 1))));
    const py = Math.min(this._demH - 1, Math.max(0, Math.floor(v * (this._demH - 1))));
    const idx = (py * this._demW + px) * 4;
    const data = this._demImageData.data;
    return data[idx] * 256 + data[idx + 1] + data[idx + 2] / 256 - 32768;
  }

  setSun(azimuth, altitude) {
    this.azimuth  = azimuth;
    this.altitude = altitude;
    if (this._map) this._map.triggerRepaint();
  }

  setOpacity(o) {
    this.opacity = o;
    if (this._map) this._map.triggerRepaint();
  }

  // CustomLayerInterface --------------------------------------------------

  onAdd(map, gl) {
    this._map = map;
    this._gl  = gl;

    const vs = compile(gl, gl.VERTEX_SHADER,   VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("Shadow program link failed: " + gl.getProgramInfoLog(prog));
    }
    this._program = prog;

    this._attribs.a_merc = gl.getAttribLocation(prog, "a_merc");
    this._attribs.a_uv   = gl.getAttribLocation(prog, "a_uv");
    this._uniforms.u_matrix    = gl.getUniformLocation(prog, "u_matrix");
    this._uniforms.u_dem       = gl.getUniformLocation(prog, "u_dem");
    this._uniforms.u_sunStep   = gl.getUniformLocation(prog, "u_sunStep");
    this._uniforms.u_stepCount = gl.getUniformLocation(prog, "u_stepCount");
    this._uniforms.u_maxElev   = gl.getUniformLocation(prog, "u_maxElev");
    this._uniforms.u_color     = gl.getUniformLocation(prog, "u_color");
    this._uniforms.u_debugMode = gl.getUniformLocation(prog, "u_debugMode");

    this._buf = gl.createBuffer();

    this._texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // 1x1 placeholder
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 128, 0, 255]));

    if (this.dem) {
      this._demDirty = true;
      this._buildQuad();
    }
  }

  onRemove() {
    const gl = this._gl;
    if (!gl) return;
    if (this._program) gl.deleteProgram(this._program);
    if (this._buf)     gl.deleteBuffer(this._buf);
    if (this._texture) gl.deleteTexture(this._texture);
    this._program = this._buf = this._texture = null;
  }

  render(gl, matrix) {
    if (!this.dem || !this._program) return;
    if (this.altitude <= 0) return;          // sun below horizon → nothing to render

    if (this._demDirty) this._uploadDEM(gl);

    // Step in DEM UV space + elevation, per ray-march step (metres).
    const rad = Math.PI / 180;
    const az  = this.azimuth  * rad;
    const alt = this.altitude * rad;
    const cosA = Math.cos(alt);
    const eastUnit  = cosA * Math.sin(az);
    const northUnit = cosA * Math.cos(az);
    const upUnit    = Math.sin(alt);

    const du =  (eastUnit  * this.stepM) / this.dem.widthM;
    const dv = -(northUnit * this.stepM) / this.dem.heightM;
    const dh =   upUnit    * this.stepM;

    gl.useProgram(this._program);
    gl.uniformMatrix4fv(this._uniforms.u_matrix, false, matrix);
    gl.uniform1i(this._uniforms.u_dem, 0);
    gl.uniform3f(this._uniforms.u_sunStep, du, dv, dh);
    gl.uniform1f(this._uniforms.u_stepCount, this.stepCount);
    gl.uniform1f(this._uniforms.u_maxElev,  this.dem.maxElev + 50);
    gl.uniform4f(this._uniforms.u_color,
      this.colorRgb[0], this.colorRgb[1], this.colorRgb[2], this.opacity);
    gl.uniform1i(this._uniforms.u_debugMode, this.debugMode || 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._buf);
    const stride = 4 * 4;
    gl.enableVertexAttribArray(this._attribs.a_merc);
    gl.vertexAttribPointer(this._attribs.a_merc, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this._attribs.a_uv);
    gl.vertexAttribPointer(this._attribs.a_uv,   2, gl.FLOAT, false, stride, 8);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.disableVertexAttribArray(this._attribs.a_merc);
    gl.disableVertexAttribArray(this._attribs.a_uv);
  }

  // Internal --------------------------------------------------------------

  _uploadDEM(gl) {
    if (!this.dem) return;
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.dem.canvas);
    this._demDirty = false;
  }

  _buildQuad() {
    if (!this.dem || !this._gl || !this._buf) return;
    const b = this.dem.bbox;
    const x0 = mercX(b.minLon), x1 = mercX(b.maxLon);
    const y0 = mercY(b.maxLat), y1 = mercY(b.minLat); // y0 < y1 (north has lower mercY)
    // Triangle strip: NW, NE, SW, SE
    // u,v: 0,0 NW   1,0 NE   0,1 SW   1,1 SE
    const verts = new Float32Array([
      x0, y0, 0, 0,   // NW
      x1, y0, 1, 0,   // NE
      x0, y1, 0, 1,   // SW
      x1, y1, 1, 1,   // SE
    ]);
    const gl = this._gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  }
}
