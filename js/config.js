/**
 * Build-time config baked into the static deploy.
 *
 * The ShadeMap JWT goes here so users don't need to bring their own.
 * It WILL be visible in the deployed source — this is fine for the
 * free educational tier but worth keeping in mind if you see abuse.
 * If this string is empty, sun.js falls back to localStorage / the
 * ?shademap_key= URL parameter (legacy behaviour).
 *
 * To rotate: drop a new JWT here and push.
 */

export const SHADEMAP_API_KEY = "";

