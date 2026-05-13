/**
 * ShadeMap (sun-shadow plugin) integration + time-of-day controls.
 *
 * Shadows only render in 2D (pitch < 25°). API key is fetched from
 * localStorage (or `?shademap_key=` URL parameter on first visit).
 */

const SHADOW_PITCH_LIMIT = 25;
const DEFAULT_DATE = "2026-02-15";
const DEFAULT_MINUTES = 720; // 12:00 noon

let shadeMap = null;

export function getShadeMap() { return shadeMap; }

function getApiKey() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("shademap_key")) {
    const k = params.get("shademap_key").trim();
    if (k) {
      localStorage.setItem("shademap_api_key", k);
      params.delete("shademap_key");
      const url =
        window.location.pathname +
        (params.toString() ? "?" + params.toString() : "") +
        window.location.hash;
      window.history.replaceState({}, "", url);
      return k;
    }
  }
  return (localStorage.getItem("shademap_api_key") || "").trim();
}

export function wireSun(map) {
  const dateEl = document.getElementById("sun-date");
  const timeLabel = document.getElementById("sun-time-label");
  const sunStatus = document.getElementById("sun-status");
  const shadowsCheckbox = document.getElementById("lyr-shadows");
  const playBtn = document.getElementById("sun-play");
  const gearBtn = document.getElementById("sun-key-gear");

  dateEl.value = DEFAULT_DATE;
  let sunMinutes = DEFAULT_MINUTES;
  let shadowsWanted = shadowsCheckbox.checked;
  let shadowsCurrentlyAdded = false;
  let playTimer = null;
  let apiKey = getApiKey();

  function currentSunDate() {
    const d = dateEl.valueAsDate || new Date();
    return new Date(Date.UTC(
      d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
      Math.floor(sunMinutes / 60) - 1, // CET → UTC
      sunMinutes % 60, 0, 0,
    ));
  }
  function fmtTime(m) {
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }
  function fmtDate(d) {
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  const trackMarker = document.getElementById("sun-track-marker");
  const sectionHeading = document.getElementById("sun-section-heading");
  const sunStatusLine = document.getElementById("sun-status-line");
  const sunShadowState = document.getElementById("sun-shadow-state");

  function updateExternalSunChrome() {
    const pct = (sunMinutes / 1440) * 100;
    if (timeLabel) {
      timeLabel.textContent = fmtTime(sunMinutes);
      timeLabel.style.left = pct + "%";
    }
    if (trackMarker) trackMarker.style.left = pct + "%";
    const d = dateEl.valueAsDate || new Date();
    if (sectionHeading) sectionHeading.textContent = `Sun · ${fmtDate(d)} · ${fmtTime(sunMinutes)}`;
    if (sunStatusLine) sunStatusLine.textContent = `${fmtDate(d)} · ${fmtTime(sunMinutes)}`;
  }

  function setSunMinutes(m) {
    sunMinutes = ((m % 1440) + 1440) % 1440;
    updateExternalSunChrome();
    if (shadeMap) shadeMap.setDate(currentSunDate());
  }
  function shouldShowShadows() {
    return shadowsWanted && shadeMap && map.getPitch() < SHADOW_PITCH_LIMIT;
  }
  function updateSunStatus() {
    let state = "off";
    if (!shadeMap) state = "no key";
    else if (!shadowsWanted) state = "off";
    else if (map.getPitch() >= SHADOW_PITCH_LIMIT) state = "hidden in 3D";
    else state = "active";
    if (sunStatus) sunStatus.textContent = "Shadows " + state;
    if (sunShadowState) sunShadowState.textContent = state;
  }
  function applyShadowVisibility() {
    if (!shadeMap) return;
    const want = shouldShowShadows();
    if (want && !shadowsCurrentlyAdded) {
      shadeMap.addTo(map);
      shadowsCurrentlyAdded = true;
      if (map.getLayer("hillshade")) {
        map.setLayoutProperty("hillshade", "visibility", "none");
      }
    } else if (!want && shadowsCurrentlyAdded) {
      shadeMap.remove();
      shadowsCurrentlyAdded = false;
      if (map.getLayer("hillshade")) {
        map.setLayoutProperty("hillshade", "visibility", "visible");
      }
    }
    updateSunStatus();
  }

  function initShadows() {
    if (!apiKey) {
      sunStatus.innerHTML =
        'No key. <a href="#" id="enter-key-link" style="color:#88c">Enter key</a> · ' +
        '<a href="https://shademap.app/about/" target="_blank" style="color:#88c">get free key</a>';
      shadowsCheckbox.disabled = true;
      const link = document.getElementById("enter-key-link");
      if (link) link.addEventListener("click", (e) => { e.preventDefault(); showKeyPrompt(); });
      return;
    }
    if (typeof ShadeMap === "undefined") {
      sunStatus.textContent = "ShadeMap plugin failed to load.";
      return;
    }
    shadeMap = new ShadeMap({
      date: currentSunDate(),
      color: "#01112f",
      opacity: 0.55,
      apiKey,
      terrainSource: {
        tileSize: 512,
        maxZoom: 13,
        getSourceUrl: ({ x, y, z }) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,
        getElevation: ({ r, g, b }) => r * 256 + g + b / 256 - 32768,
      },
    });
    // applyShadowVisibility decides whether to actually attach
  }

  // Discrete time buttons
  document.getElementById("sun-h-minus").addEventListener("click", () => setSunMinutes(sunMinutes - 60));
  document.getElementById("sun-h-plus").addEventListener("click", () => setSunMinutes(sunMinutes + 60));
  document.getElementById("sun-m-minus").addEventListener("click", () => setSunMinutes(sunMinutes - 15));
  document.getElementById("sun-m-plus").addEventListener("click", () => setSunMinutes(sunMinutes + 15));
  document.getElementById("sun-now").addEventListener("click", () => setSunMinutes(DEFAULT_MINUTES));
  dateEl.addEventListener("change", () => {
    updateExternalSunChrome();
    if (shadeMap) shadeMap.setDate(currentSunDate());
  });

  // Play / stop
  function stopPlay() {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    playBtn.textContent = "▶";
    playBtn.title = "Animate one full day";
  }
  playBtn.addEventListener("click", () => {
    if (playTimer) { stopPlay(); return; }
    playBtn.textContent = "⏸";
    playBtn.title = "Pause";
    playTimer = setInterval(() => setSunMinutes(sunMinutes + 5), 400);
  });

  shadowsCheckbox.addEventListener("change", (e) => {
    shadowsWanted = e.target.checked;
    applyShadowVisibility();
  });
  map.on("pitchend", applyShadowVisibility);
  map.on("pitch", updateSunStatus);

  gearBtn.addEventListener("click", showKeyPrompt);

  function showKeyPrompt() {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:2000;
      background:rgba(0,0,0,0.7);
      display:flex; align-items:center; justify-content:center;
    `;
    overlay.innerHTML = `
      <div style="background:#1f232b;color:#eee;padding:24px;border-radius:10px;
                  max-width:480px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.5);
                  font-family:-apple-system,BlinkMacSystemFont,sans-serif">
        <h2 style="margin:0 0 10px;font-size:16px">ShadeMap API key</h2>
        <p style="margin:0 0 14px;font-size:13px;color:#bbb;line-height:1.5">
          Required to render sun shadows. Free educational tier covers localhost
          / file:// use. Get a key
          <a href="https://shademap.app/about/" target="_blank"
             style="color:#88c">here</a>. Stored in this browser only.
        </p>
        <input id="key-input" type="text" placeholder="Paste your JWT here"
          style="width:100%;padding:8px;background:#111;color:#eee;
                 border:1px solid #555;border-radius:5px;font-size:13px;
                 font-family:ui-monospace,monospace;box-sizing:border-box">
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
          <button id="key-clear" style="background:#444;color:#eee;border:1px solid #666;
                  padding:6px 12px;border-radius:5px;font-size:12px;cursor:pointer">Clear saved</button>
          <button id="key-cancel" style="background:#333;color:#eee;border:1px solid #555;
                  padding:6px 12px;border-radius:5px;font-size:12px;cursor:pointer">Cancel</button>
          <button id="key-save" style="background:#0066ff;color:white;border:none;
                  padding:6px 14px;border-radius:5px;font-size:12px;cursor:pointer;
                  font-weight:600">Save &amp; reload</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector("#key-input");
    input.value = apiKey || "";
    input.focus(); input.select();
    overlay.querySelector("#key-cancel").onclick = () => overlay.remove();
    overlay.querySelector("#key-clear").onclick = () => {
      localStorage.removeItem("shademap_api_key");
      overlay.remove(); window.location.reload();
    };
    overlay.querySelector("#key-save").onclick = () => {
      const v = input.value.trim();
      if (v) localStorage.setItem("shademap_api_key", v);
      else   localStorage.removeItem("shademap_api_key");
      overlay.remove(); window.location.reload();
    };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") overlay.querySelector("#key-save").click();
      if (e.key === "Escape") overlay.remove();
    });
  }

  updateExternalSunChrome();
  initShadows();
  applyShadowVisibility();
}
