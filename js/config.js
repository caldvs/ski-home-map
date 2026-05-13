/**
 * Build-time config injected at deploy time from the SHADEMAP_API_KEY
 * repo secret (.github/workflows/deploy.yml). The committed value is
 * empty so the JWT never lives in git.
 *
 * Local override: drop a sibling file `js/config.local.js` that
 * exports the same constant — it's gitignored and takes precedence
 * over the empty default. Lets you test shadows on localhost without
 * touching the deploy.
 */

const BAKED_KEY = "";

let overrideKey = "";
try {
  // Dynamic import returns a promise; top-level await holds module
  // evaluation until it settles. If the file doesn't exist (the common
  // case for fresh clones), we swallow the error and keep BAKED_KEY.
  const m = await import("./config.local.js");
  overrideKey = (m.SHADEMAP_API_KEY || "").trim();
} catch (e) { /* no local override — fine */ }

export const SHADEMAP_API_KEY = overrideKey || BAKED_KEY;

