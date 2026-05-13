/**
 * Unbounded horizontal time scrubber.
 *
 * Conceptually it's a film-strip of minutes that the user drags
 * left/right past a fixed central needle. There's no bound — drag
 * past midnight and the date increments; drag back past 00:00 and
 * the date decrements. Mouse wheel also scrolls through time.
 *
 *   ‹————————— window (~12 h centred on selected time) —————————›
 *   |‖‖‖‖ ticks every hour, sunrise + sunset markers ‖‖‖‖‖‖‖‖‖|
 *                              │ needle (anchored)
 *
 * Usage:
 *     const sc = new TimeScrubber({
 *       container,
 *       onChange: (date) => updateMap(date),
 *       sunPositionFn: (date) => ({ altitude, azimuth }),
 *     });
 *     sc.setDate(new Date());
 */

const WINDOW_MINUTES = 720;   // ±6 h visible at any time
const TICK_MINUTES   = 60;    // hour ticks
const WHEEL_MINUTES  = 5;     // minutes per wheel tick
const MS_PER_MIN     = 60_000;

function fmtDate(d) {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
function fmtTime(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export class TimeScrubber {
  constructor(opts) {
    this.container = opts.container;
    this.onChange = opts.onChange || (() => {});
    this.sunPositionFn = opts.sunPositionFn || (() => ({ altitude: 30, azimuth: 180 }));

    this.currentDate = new Date();
    this.playTimer = null;

    this._build();
    this._wire();
    this.render();
  }

  // Public API ------------------------------------------------------------

  setDate(d, opts = {}) {
    this.currentDate = new Date(d.getTime());
    this.render();
    if (!opts.silent) this.onChange(this.currentDate);
  }
  getDate() { return new Date(this.currentDate.getTime()); }

  // Internal --------------------------------------------------------------

  _build() {
    this.container.innerHTML = `
      <div class="scrub-head">
        <div class="scrub-date mono"><span id="sc-date">—</span> · <span id="sc-time">—</span></div>
        <div class="scrub-stats mono"><span id="sc-stats">—</span></div>
        <div class="scrub-actions">
          <button class="scrub-btn" data-action="day-back" title="−1 day">‹‹ Day</button>
          <button class="scrub-btn" data-action="hr-back"  title="−1 hour">‹ Hr</button>
          <button class="scrub-btn" data-action="now"      title="Reset to now">Now</button>
          <button class="scrub-btn" data-action="hr-fwd"   title="+1 hour">Hr ›</button>
          <button class="scrub-btn" data-action="day-fwd"  title="+1 day">Day ››</button>
          <button class="scrub-btn primary" data-action="play" title="Animate one day">▶ Day</button>
        </div>
      </div>
      <div class="scrub-strip" id="sc-strip">
        <svg class="scrub-svg" id="sc-svg" preserveAspectRatio="none"></svg>
        <div class="scrub-needle"></div>
      </div>
    `;
    this.dateEl    = this.container.querySelector("#sc-date");
    this.timeEl    = this.container.querySelector("#sc-time");
    this.statsEl   = this.container.querySelector("#sc-stats");
    this.stripEl   = this.container.querySelector("#sc-strip");
    this.svgEl     = this.container.querySelector("#sc-svg");
  }

  _wire() {
    // Buttons.
    this.container.querySelectorAll(".scrub-btn[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const a = btn.dataset.action;
        if (a === "now")      this.setDate(new Date());
        else if (a === "hr-back") this._shift(-60);
        else if (a === "hr-fwd")  this._shift(+60);
        else if (a === "day-back") this._shift(-60 * 24);
        else if (a === "day-fwd")  this._shift(+60 * 24);
        else if (a === "play") this._togglePlay();
      });
    });

    // Click-drag on the strip.
    let dragging = false, startX = 0, startDate = null;
    this.stripEl.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startDate = new Date(this.currentDate.getTime());
      this.stripEl.classList.add("dragging");
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const w = this.stripEl.clientWidth || 1;
      const mpp = WINDOW_MINUTES / w;       // minutes per pixel
      const dxMin = (startX - e.clientX) * mpp;
      const next = new Date(startDate.getTime() + dxMin * MS_PER_MIN);
      this.setDate(next);
    });
    window.addEventListener("mouseup", () => {
      if (dragging) this.stripEl.classList.remove("dragging");
      dragging = false;
    });

    // Touch.
    this.stripEl.addEventListener("touchstart", (e) => {
      if (!e.touches[0]) return;
      dragging = true;
      startX = e.touches[0].clientX;
      startDate = new Date(this.currentDate.getTime());
      this.stripEl.classList.add("dragging");
    }, { passive: true });
    this.stripEl.addEventListener("touchmove", (e) => {
      if (!dragging || !e.touches[0]) return;
      const w = this.stripEl.clientWidth || 1;
      const mpp = WINDOW_MINUTES / w;
      const dxMin = (startX - e.touches[0].clientX) * mpp;
      const next = new Date(startDate.getTime() + dxMin * MS_PER_MIN);
      this.setDate(next);
    }, { passive: true });
    this.stripEl.addEventListener("touchend", () => {
      dragging = false;
      this.stripEl.classList.remove("dragging");
    });

    // Wheel.
    this.stripEl.addEventListener("wheel", (e) => {
      e.preventDefault();
      const dir = Math.sign(e.deltaY);
      this._shift(dir * WHEEL_MINUTES);
    }, { passive: false });
  }

  _shift(minutes) {
    const d = new Date(this.currentDate.getTime() + minutes * MS_PER_MIN);
    this.setDate(d);
  }

  _togglePlay() {
    const btn = this.container.querySelector('[data-action="play"]');
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
      btn.textContent = "▶ Day";
      return;
    }
    btn.textContent = "⏸ Stop";
    // ~96 frames per "day" → 5-minute increments at 250ms intervals
    this.playTimer = setInterval(() => this._shift(5), 250);
  }

  // Find when altitude crosses 0 around `d`, scanning ±18h.
  _findSunCross(d, rising) {
    const start = new Date(d.getTime());
    start.setHours(0, 0, 0, 0);
    const dayStart = start.getTime();
    let prev = this.sunPositionFn(new Date(dayStart - 3600_000)).altitude;
    for (let m = 0; m < 1440; m += 5) {
      const t = new Date(dayStart + m * MS_PER_MIN);
      const alt = this.sunPositionFn(t).altitude;
      if (rising && prev < 0 && alt >= 0)  return t;
      if (!rising && prev >= 0 && alt < 0) return t;
      prev = alt;
    }
    return null;
  }

  // Drawing ---------------------------------------------------------------

  render() {
    const d = this.currentDate;
    const sun = this.sunPositionFn(d);
    this.dateEl.textContent = fmtDate(d);
    this.timeEl.textContent = fmtTime(d);
    this.statsEl.textContent =
      `altitude ${sun.altitude.toFixed(1)}°  ·  azimuth ${sun.azimuth.toFixed(0)}°`;

    const w = this.stripEl.clientWidth || 800;
    const h = 56;
    const halfMin = WINDOW_MINUTES / 2;
    const center = d.getTime();
    const left   = center - halfMin * MS_PER_MIN;
    const minPerPx = WINDOW_MINUTES / w;
    const xForTime = (t) => (t - left) / MS_PER_MIN / minPerPx;

    // Sun-altitude band: sample every ~8 minutes across the visible
    // window and shade the strip from dark blue (night) to warm
    // gold (high sun).
    const SAMPLES = Math.min(96, Math.floor(w / 10));
    let bandPath = "";
    let gradientStops = "";
    for (let i = 0; i <= SAMPLES; i++) {
      const f = i / SAMPLES;
      const t = left + WINDOW_MINUTES * f * MS_PER_MIN;
      const alt = this.sunPositionFn(new Date(t)).altitude;
      // Map altitude (-90..+90) into a stop colour. Below 0 = night.
      const c = altToColour(alt);
      gradientStops += `<stop offset="${(f * 100).toFixed(2)}%" stop-color="${c}"/>`;
    }

    // Find sunrise / sunset for the day enclosing `d`.
    const sunrise = this._findSunCross(d, true);
    const sunset  = this._findSunCross(d, false);

    // Hour ticks: hours that fall inside [left, left + WINDOW_MINUTES].
    let ticks = "";
    const startMs = left;
    const endMs   = left + WINDOW_MINUTES * MS_PER_MIN;
    const startHour = Math.ceil(startMs / 3600_000) * 3600_000;
    for (let t = startHour; t <= endMs; t += TICK_MINUTES * MS_PER_MIN) {
      const x = xForTime(t);
      const tickDate = new Date(t);
      const hour = tickDate.getHours();
      const isMajor = hour % 3 === 0;
      const y1 = isMajor ? 0 : 6;
      ticks += `<line x1="${x.toFixed(1)}" y1="${y1}" x2="${x.toFixed(1)}" y2="22" `
            +  `stroke="${isMajor ? '#1a1814' : '#8a8064'}" stroke-width="${isMajor ? 1 : 0.5}" opacity="0.55"/>`;
      if (isMajor) {
        ticks += `<text x="${x.toFixed(1)}" y="36" text-anchor="middle" `
              +  `fill="#1a1814" font-size="10" font-family="JetBrains Mono, monospace">`
              +  `${String(hour).padStart(2, "0")}:00</text>`;
      }
    }

    // Sunrise / sunset markers.
    let solarMarks = "";
    for (const [t, label, colour] of [[sunrise, "↑", "#e87a25"], [sunset, "↓", "#7b4ea6"]]) {
      if (!t) continue;
      const x = xForTime(t.getTime());
      if (x < -10 || x > w + 10) continue;
      solarMarks += `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${h}" `
                 +  `stroke="${colour}" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.85"/>`;
      solarMarks += `<text x="${x.toFixed(1)}" y="14" text-anchor="middle" `
                 +  `fill="${colour}" font-size="11" font-family="Geist, sans-serif" `
                 +  `font-weight="600">${label}${fmtTime(t)}</text>`;
    }

    this.svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this.svgEl.setAttribute("width", w);
    this.svgEl.setAttribute("height", h);
    this.svgEl.innerHTML = `
      <defs>
        <linearGradient id="scrubSky" x1="0" x2="1" y1="0" y2="0">
          ${gradientStops}
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${w}" height="${h}" fill="url(#scrubSky)"/>
      ${ticks}
      ${solarMarks}
    `;
  }
}

// Map solar altitude to a sky-strip colour.
//   alt < −10°  → deep blue night
//   alt   0°    → twilight orange
//   alt   30°+  → warm pale yellow
function altToColour(alt) {
  if (alt < -12) return "#0e1428";
  if (alt < 0)   {
    const t = (alt + 12) / 12;            // 0..1 from deep night to horizon
    return mix("#0e1428", "#d57a3a", t);
  }
  if (alt < 30) {
    const t = alt / 30;
    return mix("#d57a3a", "#f3e4b5", t);
  }
  return "#f3e4b5";
}

function mix(a, b, t) {
  const ai = hexToRgb(a), bi = hexToRgb(b);
  const r = Math.round(ai[0] + (bi[0] - ai[0]) * t);
  const g = Math.round(ai[1] + (bi[1] - ai[1]) * t);
  const bb = Math.round(ai[2] + (bi[2] - ai[2]) * t);
  return `rgb(${r},${g},${bb})`;
}
function hexToRgb(h) {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}
