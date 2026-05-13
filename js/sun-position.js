/**
 * Solar position calculator — NOAA General Solar Position Algorithm,
 * compressed. Returns the sun's azimuth (deg, clockwise from north)
 * and altitude (deg above horizon) at a given UTC date for a given
 * lat/lon on Earth's surface.
 *
 * Accuracy: about 0.05° (~3') for the foreseeable future — good enough
 * for shadow rendering on terrain. Reference:
 * https://gml.noaa.gov/grad/solcalc/calcdetails.html
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export function sunPosition(date, lat, lon) {
  // Julian day (UT)
  const julianDay = date.getTime() / 86400000 + 2440587.5;
  // Julian century since J2000
  const t = (julianDay - 2451545.0) / 36525;

  // Geometric mean longitude of the Sun (deg)
  let L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  if (L0 < 0) L0 += 360;

  // Geometric mean anomaly of the Sun (deg)
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);

  // Eccentricity of Earth's orbit
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  // Sun's equation of center
  const C =
    Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * M * RAD) * 0.000289;

  // Sun's true longitude
  const trueLong = L0 + C;

  // Apparent longitude (corrected for nutation + aberration)
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  // Mean obliquity of the ecliptic (deg)
  const eps0 =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const epsObl = eps0 + 0.00256 * Math.cos(omega * RAD);

  // Declination (deg)
  const declination = Math.asin(Math.sin(epsObl * RAD) * Math.sin(lambda * RAD)) * DEG;

  // Equation of time (minutes)
  const y = Math.tan(((epsObl / 2) * RAD)) ** 2;
  const eqTime =
    4 * DEG *
    (y * Math.sin(2 * L0 * RAD) -
      2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * e * e * Math.sin(2 * M * RAD));

  // Local true solar time (minutes since solar midnight)
  const utMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60000;
  let trueSolar = utMinutes + eqTime + 4 * lon;
  trueSolar = ((trueSolar % 1440) + 1440) % 1440;

  // Hour angle (deg, 0 at solar noon, +180 evening / −180 morning)
  let H = trueSolar / 4 - 180;

  // Solar zenith + altitude
  const cosZ =
    Math.sin(lat * RAD) * Math.sin(declination * RAD) +
    Math.cos(lat * RAD) * Math.cos(declination * RAD) * Math.cos(H * RAD);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZ))) * DEG;
  const altitude = 90 - zenith;

  // Solar azimuth (deg, clockwise from north)
  let azimuth = 0;
  const sinZ = Math.sin(zenith * RAD);
  if (sinZ > 1e-9) {
    const cosA =
      (Math.sin(declination * RAD) - Math.sin(lat * RAD) * cosZ) /
      (Math.cos(lat * RAD) * sinZ);
    azimuth = Math.acos(Math.max(-1, Math.min(1, cosA))) * DEG;
    // NOAA: H > 0 (after noon) → 360 − az; H < 0 → az (still need
    // to add 180 because NOAA measures azimuth from south.) The form
    // below gives clockwise-from-north convention.
    if (H > 0) azimuth = (azimuth + 180) % 360;
    else azimuth = (540 - azimuth) % 360;
  }

  return { altitude, azimuth, declination, hourAngle: H };
}
