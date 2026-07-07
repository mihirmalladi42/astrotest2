const SKYVIEW_ENDPOINT = "https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl";

const state = {
  lat: 37.7749,
  lon: -122.4194,
  az: 180,
  alt: 45,
  roll: 0,
  fov: 2,
  pixels: 768,
  survey: "DSS2 Red",
  cameraReady: false,
  centerCoords: null,
  target: null,
  guideAzDirection: 0,
  guideTargetId: null,
};

const $ = (id) => document.getElementById(id);
const catalog = window.ASTRO_CATALOG || { objects: [], constellations: [] };
const PLANET_ELEMENTS = {
  Mercury: { N: [48.3313, 3.24587e-5], i: [7.0047, 5.0e-8], w: [29.1241, 1.01444e-5], a: [0.387098, 0], e: [0.205635, 5.59e-10], M: [168.6562, 4.0923344368] },
  Venus: { N: [76.6799, 2.4659e-5], i: [3.3946, 2.75e-8], w: [54.8910, 1.38374e-5], a: [0.723330, 0], e: [0.006773, -1.302e-9], M: [48.0052, 1.6021302244] },
  Mars: { N: [49.5574, 2.11081e-5], i: [1.8497, -1.78e-8], w: [286.5016, 2.92961e-5], a: [1.523688, 0], e: [0.093405, 2.516e-9], M: [18.6021, 0.5240207766] },
  Jupiter: { N: [100.4542, 2.76854e-5], i: [1.3030, -1.557e-7], w: [273.8777, 1.64505e-5], a: [5.20256, 0], e: [0.048498, 4.469e-9], M: [19.8950, 0.0830853001] },
  Saturn: { N: [113.6634, 2.3898e-5], i: [2.4886, -1.081e-7], w: [339.3939, 2.97661e-5], a: [9.55475, 0], e: [0.055546, -9.499e-9], M: [316.9670, 0.0334442282] },
  Uranus: { N: [74.0005, 1.3978e-5], i: [0.7733, 1.9e-8], w: [96.6612, 3.0565e-5], a: [19.18171, -1.55e-8], e: [0.047318, 7.45e-9], M: [142.5905, 0.011725806] },
  Neptune: { N: [131.7806, 3.0173e-5], i: [1.7700, -2.55e-7], w: [272.8461, -6.027e-6], a: [30.05826, 3.313e-8], e: [0.008606, 2.15e-9], M: [260.2471, 0.005995147] },
};

const degToRad = (deg) => (deg * Math.PI) / 180;
const radToDeg = (rad) => (rad * 180) / Math.PI;
const wrap360 = (deg) => ((deg % 360) + 360) % 360;
const signedDeltaDeg = (toDeg, fromDeg) => {
  const delta = wrap360(toDeg - fromDeg);
  return delta > 180 ? delta - 360 : delta;
};
const signOrZero = (value) => (value > 0 ? 1 : value < 0 ? -1 : 0);

function julianDate(date = new Date()) {
  return date.getTime() / 86400000 + 2440587.5;
}

function greenwichSiderealTime(date = new Date()) {
  const jd = julianDate(date);
  const t = (jd - 2451545.0) / 36525.0;
  const gmst =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000.0;
  return wrap360(gmst);
}

function localSiderealTime(lonDeg, date = new Date()) {
  return wrap360(greenwichSiderealTime(date) + lonDeg);
}

function horizontalToEquatorial({ azDeg, altDeg, latDeg, lonDeg, date = new Date() }) {
  const az = degToRad(azDeg);
  const alt = degToRad(altDeg);
  const lat = degToRad(latDeg);

  const sinDec =
    Math.sin(alt) * Math.sin(lat) +
    Math.cos(alt) * Math.cos(lat) * Math.cos(az);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));

  const hourAngle = Math.atan2(
    -Math.sin(az) * Math.cos(alt),
    Math.sin(alt) * Math.cos(lat) - Math.cos(alt) * Math.sin(lat) * Math.cos(az)
  );

  const lst = localSiderealTime(lonDeg, date);
  const ra = wrap360(lst - radToDeg(hourAngle));

  return {
    raDeg: ra,
    decDeg: radToDeg(dec),
    lstDeg: lst,
    hourAngleDeg: wrap360(radToDeg(hourAngle)),
  };
}

function equatorialToHorizontal({ raDeg, decDeg, latDeg, lonDeg, date = new Date() }) {
  const lst = localSiderealTime(lonDeg, date);
  const hourAngle = degToRad(signedDeltaDeg(lst, raDeg));
  const dec = degToRad(decDeg);
  const lat = degToRad(latDeg);

  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(hourAngle);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(hourAngle)
  );

  return {
    azDeg: wrap360(radToDeg(az)),
    altDeg: radToDeg(alt),
  };
}

function daysSinceJ2000(date = new Date()) {
  return julianDate(date) - 2451543.5;
}

function orbitalValue(pair, days) {
  return pair[0] + pair[1] * days;
}

function heliocentricEcliptic(planetName, date = new Date()) {
  const elements = PLANET_ELEMENTS[planetName];
  if (!elements) return null;
  const days = daysSinceJ2000(date);
  const N = degToRad(orbitalValue(elements.N, days));
  const i = degToRad(orbitalValue(elements.i, days));
  const w = degToRad(orbitalValue(elements.w, days));
  const a = orbitalValue(elements.a, days);
  const e = orbitalValue(elements.e, days);
  const M = degToRad(wrap360(orbitalValue(elements.M, days)));
  let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
  for (let step = 0; step < 4; step += 1) {
    E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }
  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const cosN = Math.cos(N);
  const sinN = Math.sin(N);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const vw = v + w;
  const cosVw = Math.cos(vw);
  const sinVw = Math.sin(vw);
  return {
    x: r * (cosN * cosVw - sinN * sinVw * cosI),
    y: r * (sinN * cosVw + cosN * sinVw * cosI),
    z: r * sinVw * sinI,
  };
}

function planetEquatorial(planetName, date = new Date()) {
  const earth = heliocentricEcliptic("Earth", date);
  const planet = heliocentricEcliptic(planetName, date);
  if (!earth || !planet) return null;
  const x = planet.x - earth.x;
  const y = planet.y - earth.y;
  const z = planet.z - earth.z;
  const obliquity = degToRad(23.4393 - 3.563e-7 * daysSinceJ2000(date));
  const yEq = y * Math.cos(obliquity) - z * Math.sin(obliquity);
  const zEq = y * Math.sin(obliquity) + z * Math.cos(obliquity);
  return {
    raDeg: wrap360(radToDeg(Math.atan2(yEq, x))),
    decDeg: radToDeg(Math.atan2(zEq, Math.hypot(x, yEq))),
  };
}

PLANET_ELEMENTS.Earth = { N: [0, 0], i: [0, 0], w: [282.9404, 4.70935e-5], a: [1.0, 0], e: [0.016709, -1.151e-9], M: [356.0470, 0.9856002585] };

function objectEquatorial(object, date = new Date()) {
  if (!object) return null;
  if (object.kind === "planet") return planetEquatorial(object.name, date);
  return { raDeg: object.ra, decDeg: object.dec };
}

function angularDistanceDeg(aRa, aDec, bRa, bDec) {
  const ra1 = degToRad(aRa);
  const ra2 = degToRad(bRa);
  const dec1 = degToRad(aDec);
  const dec2 = degToRad(bDec);
  const cosSep =
    Math.sin(dec1) * Math.sin(dec2) +
    Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  return radToDeg(Math.acos(Math.max(-1, Math.min(1, cosSep))));
}

function raDegToHms(raDeg) {
  const totalSeconds = (wrap360(raDeg) / 15) * 3600;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${s.toFixed(1).padStart(4, "0")}s`;
}

function decDegToDms(decDeg) {
  const sign = decDeg < 0 ? "-" : "+";
  const abs = Math.abs(decDeg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d) * 60 - m) * 60;
  return `${sign}${String(d).padStart(2, "0")}d ${String(m).padStart(2, "0")}m ${s.toFixed(0).padStart(2, "0")}s`;
}

function angleDegToDms(angleDeg, { signed = false } = {}) {
  const normalized = signed ? angleDeg : wrap360(angleDeg);
  const sign = signed && normalized >= 0 ? "+" : normalized < 0 ? "-" : "";
  const totalSeconds = Math.round(Math.abs(normalized) * 3600);
  const d = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${sign}${String(d).padStart(3, "0")}d ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function skyViewUrl(raDeg, decDeg) {
  const params = new URLSearchParams({
    Position: `${raDeg.toFixed(6)},${decDeg.toFixed(6)}`,
    Survey: state.survey,
    Coordinates: "J2000",
    Projection: "Tan",
    Size: String(state.fov),
    Pixels: String(state.pixels),
    Scaling: "Log",
    Return: "JPEG",
  });
  return `${SKYVIEW_ENDPOINT}?${params.toString()}`;
}

function sizeOverlayCanvas() {
  const canvas = $("skyOverlay");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function stableGuideAzDelta(rawDeltaAz, targetId) {
  if (state.guideTargetId !== targetId) {
    state.guideTargetId = targetId;
    state.guideAzDirection = 0;
  }

  const rawDirection = signOrZero(rawDeltaAz);
  const absDelta = Math.abs(rawDeltaAz);
  const lockThreshold = 135;
  const releaseThreshold = 105;

  if (absDelta >= lockThreshold && state.guideAzDirection !== 0) {
    return state.guideAzDirection * absDelta;
  }

  if (absDelta <= releaseThreshold || state.guideAzDirection === 0) {
    state.guideAzDirection = rawDirection;
    return rawDeltaAz;
  }

  if (rawDirection !== 0 && rawDirection !== state.guideAzDirection) {
    return state.guideAzDirection * absDelta;
  }

  state.guideAzDirection = rawDirection;
  return rawDeltaAz;
}

function targetScreenPosition(targetAltAz) {
  sizeOverlayCanvas();
  const canvas = $("skyOverlay");
  const aspect = canvas.width / canvas.height;
  const verticalFov = Math.max(0.2, state.fov);
  const horizontalFov = verticalFov * aspect;
  const deltaAz = stableGuideAzDelta(signedDeltaDeg(targetAltAz.azDeg, state.az), state.target?.id);
  const deltaAlt = targetAltAz.altDeg - state.alt;
  const rightAngle = deltaAz * Math.cos(degToRad(state.alt));
  const upAngle = deltaAlt;

  return {
    x: canvas.width / 2 + (rightAngle / horizontalFov) * canvas.width,
    y: canvas.height / 2 - (upAngle / verticalFov) * canvas.height,
    rightAngle,
    upAngle,
    horizontalFov,
    verticalFov,
  };
}

function drawTargetFrame(ctx, targetAltAz) {
  if (targetAltAz.altDeg < 0) return;

  const canvas = $("skyOverlay");
  const projected = targetScreenPosition(targetAltAz);
  const frameSide = Math.min(canvas.width, canvas.height) * 0.7;
  const halfSide = frameSide / 2;
  const left = projected.x - halfSide;
  const top = projected.y - halfSide;

  ctx.save();
  ctx.strokeStyle = "rgba(104, 210, 198, 0.85)";
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 10]);
  ctx.strokeRect(left, top, frameSide, frameSide);
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(projected.x, projected.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(104, 210, 198, 0.95)";
  ctx.fill();
  ctx.restore();
}

function drawSkyOverlay() {
  sizeOverlayCanvas();
  const canvas = $("skyOverlay");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!state.target) return;

  const targetCoords = objectEquatorial(state.target);
  if (!targetCoords) return;

  const targetAltAz = equatorialToHorizontal({
    raDeg: targetCoords.raDeg,
    decDeg: targetCoords.decDeg,
    latDeg: state.lat,
    lonDeg: state.lon,
  });

  drawTargetFrame(ctx, targetAltAz);
}

function syncInputsFromState() {
  $("latitude").value = state.lat.toFixed(6);
  $("longitude").value = state.lon.toFixed(6);
  $("azimuth").value = state.az.toFixed(1);
  $("altitude").value = state.alt.toFixed(1);
  $("fieldOfView").value = state.fov;
  $("survey").value = state.survey;
}

function readInputs() {
  state.lat = Number($("latitude").value);
  state.lon = Number($("longitude").value);
  state.az = Number($("azimuth").value);
  state.alt = Number($("altitude").value);
  state.fov = Number($("fieldOfView").value);
  state.survey = $("survey").value;
}

function updateTelemetry(coords) {
  $("raValue").textContent = `${coords.raDeg.toFixed(4)} deg`;
  $("decValue").textContent = `${coords.decDeg.toFixed(4)} deg`;
  $("raHms").textContent = raDegToHms(coords.raDeg);
  $("decDms").textContent = decDegToDms(coords.decDeg);
  $("lstValue").textContent = `${coords.lstDeg.toFixed(3)} deg`;
  $("pointingValue").textContent = `Az ${angleDegToDms(state.az)}, Alt ${angleDegToDms(state.alt, { signed: true })}`;
  $("liveEquatorialValue").textContent = `RA ${raDegToHms(coords.raDeg)}, Dec ${decDegToDms(coords.decDeg)}`;
}

function showCaptureToast(coords) {
  const toast = $("captureToast");
  if (!toast) return;
  toast.textContent =
    `Taken picture at Alt: ${angleDegToDms(state.alt, { signed: true })}, Az: ${angleDegToDms(state.az)}\n` +
    `RA: ${raDegToHms(coords.raDeg)}, Dec: ${decDegToDms(coords.decDeg)}`;
  toast.classList.add("visible");
  clearTimeout(showCaptureToast.hideTimer);
  showCaptureToast.hideTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 7000);
}

function updateCaptureMetadata(coords, capturedAt = new Date()) {
  const metadata = $("captureMetadata");
  if (!metadata) return;
  metadata.textContent =
    `Time (UTC): ${capturedAt.toISOString()}\n` +
    `RA: ${raDegToHms(coords.raDeg)}, Dec: ${decDegToDms(coords.decDeg)}\n` +
    `Alt: ${angleDegToDms(state.alt, { signed: true })}, Az: ${angleDegToDms(state.az)}\n` +
    `Coordinates: ${state.lat.toFixed(6)}, ${state.lon.toFixed(6)}`;
}

function updateGuide(coords) {
  const liveGuideText = $("liveGuideText");
  liveGuideText.classList.remove("on-target");

  if (!state.target) {
    state.guideTargetId = null;
    state.guideAzDirection = 0;
    $("guideValue").textContent = "No target";
    $("guideHint").textContent = "Choose a target.";
    $("targetLock").textContent = "Choose a target to start guidance.";
    $("targetLock").classList.remove("on-target");
    $("targetAltAz").textContent = "Target: --";
    $("deltaAltAz").textContent = "Move: --";
    liveGuideText.textContent = "Choose target";
    return;
  }

  const targetCoords = objectEquatorial(state.target);
  if (!targetCoords) {
    $("guideValue").textContent = "No coordinates";
    $("guideHint").textContent = "This target cannot be resolved right now.";
    return;
  }

  const targetAltAz = equatorialToHorizontal({
    raDeg: targetCoords.raDeg,
    decDeg: targetCoords.decDeg,
    latDeg: state.lat,
    lonDeg: state.lon,
  });
  $("targetStatus").textContent =
    `${state.target.id}: ${state.target.name} (${state.target.type}) | ` +
    `RA ${raDegToHms(targetCoords.raDeg)}, Dec ${decDegToDms(targetCoords.decDeg)}`;
  const targetOffset = targetScreenPosition(targetAltAz);
  const screenDistance = Math.hypot(targetOffset.rightAngle, targetOffset.upAngle);
  const centerThreshold = Math.max(2, state.fov * 0.5);
  const isBelowHorizon = targetAltAz.altDeg < 0;
  const isCentered = !isBelowHorizon && screenDistance <= centerThreshold;

  const azThreshold = 0.7;
  const altThreshold = 0.7;
  const azAction = targetOffset.rightAngle > azThreshold ? "right" : targetOffset.rightAngle < -azThreshold ? "left" : "center";
  const altAction = targetOffset.upAngle > altThreshold ? "up" : targetOffset.upAngle < -altThreshold ? "down" : "center";
  const horizontalText = azAction === "center" ? "" : `${azAction} ${Math.abs(targetOffset.rightAngle).toFixed(1)}°`;
  const verticalText = altAction === "center" ? "" : `${altAction} ${Math.abs(targetOffset.upAngle).toFixed(1)}°`;
  const moveText = [horizontalText, verticalText].filter(Boolean).join(" / ") || "centered";

  $("guideValue").textContent = `${state.target.id}: ${screenDistance.toFixed(1)} deg away`;
  $("guideHint").textContent = isBelowHorizon
    ? "Target is below the horizon from this location right now."
    : isCentered
    ? "Target centered. Resolve sky for detail."
    : "Align the reticle with the target frame.";
  $("targetLock").textContent = isBelowHorizon
    ? `${state.target.id} is below the horizon`
    : isCentered
    ? `ON TARGET: ${state.target.id}`
    : `Guide to ${state.target.id}: ${moveText}`;
  $("targetLock").classList.toggle("on-target", isCentered);
  liveGuideText.classList.toggle("on-target", isCentered);
  liveGuideText.textContent = isBelowHorizon
    ? `${state.target.id} BELOW HORIZON`
    : isCentered
    ? `ON TARGET ${state.target.id}`
    : `MOVE ${moveText.toUpperCase()}`;
  $("targetAltAz").textContent = `Target: Alt ${angleDegToDms(targetAltAz.altDeg, { signed: true })}, Az ${angleDegToDms(targetAltAz.azDeg)}`;
  $("deltaAltAz").textContent = isBelowHorizon ? "Move: target below horizon" : isCentered ? "Move: centered" : `Move: ${moveText}`;
  void coords;
}

function solvePointing() {
  readInputs();
  const coords = horizontalToEquatorial({
    azDeg: state.az,
    altDeg: state.alt,
    latDeg: state.lat,
    lonDeg: state.lon,
  });
  state.centerCoords = coords;
  updateTelemetry(coords);
  updateGuide(coords);
  drawSkyOverlay();
  return coords;
}

function captureSky() {
  const capturedAt = new Date();
  const coords = solvePointing();
  const url = skyViewUrl(coords.raDeg, coords.decDeg);
  const image = $("skyImage");
  image.src = url;
  image.addEventListener("load", drawSkyOverlay, { once: true });
  state.centerCoords = coords;
  drawSkyOverlay();
  showCaptureToast(coords);
  updateCaptureMetadata(coords, capturedAt);
  $("imageLink").href = url;
  $("status").textContent = `Requested ${state.survey} at RA ${coords.raDeg.toFixed(4)} deg, Dec ${coords.decDeg.toFixed(4)} deg`;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    $("cameraStatus").textContent = "Camera API unavailable in this browser. Open in Chrome/Safari on localhost.";
    $("status").textContent = "The current browser does not expose camera access to this page.";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    $("camera").srcObject = stream;
    state.cameraReady = true;
    $("skyImage").removeAttribute("src");
    drawSkyOverlay();
    $("imageLink").href = "https://skyview.gsfc.nasa.gov/current/cgi/query.pl";
    $("cameraStatus").textContent = "Camera live";
    $("status").textContent = "Live camera view restored.";
  } catch (error) {
    const reason = error?.name || "CameraError";
    $("cameraStatus").textContent = `Camera unavailable: ${reason}`;
    $("status").textContent =
      reason === "NotAllowedError"
        ? "Camera permission was blocked. Allow camera access in the browser or OS privacy settings."
        : "This browser could not open a camera device. Manual pointing still works.";
  }
}

function applyLocation(position) {
  const { latitude, longitude, accuracy } = position.coords;
  state.lat = latitude;
  state.lon = longitude;
  syncInputsFromState();
  solvePointing();
  const accuracyText = typeof accuracy === "number" ? ` +/- ${Math.round(accuracy)} m` : "";
  $("status").textContent = `Location loaded: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}${accuracyText}`;
}

function geolocationErrorMessage(error) {
  if (!error) return "Location did not return a result.";
  if (error.code === error.PERMISSION_DENIED) return "Location permission was blocked.";
  if (error.code === error.POSITION_UNAVAILABLE) return "Location is unavailable on this device/browser.";
  if (error.code === error.TIMEOUT) return "Location timed out. Try again with GPS/Wi-Fi enabled.";
  return error.message || "Location failed.";
}

function useLocation() {
  if (!navigator.geolocation) {
    $("status").textContent = "This browser does not expose geolocation.";
    return;
  }
  $("status").textContent = "Getting fresh location...";

  let bestAccuracy = Infinity;
  let watchId = null;
  const options = { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 };

  const handlePosition = (position) => {
    const accuracy = position.coords.accuracy ?? Infinity;
    if (accuracy <= bestAccuracy) {
      bestAccuracy = accuracy;
      applyLocation(position);
    }
    if (accuracy <= 100 && watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  };

  navigator.geolocation.getCurrentPosition(
    handlePosition,
    (error) => {
      $("status").textContent = geolocationErrorMessage(error);
    },
    options
  );

  watchId = navigator.geolocation.watchPosition(
    handlePosition,
    (error) => {
      if (!Number.isFinite(bestAccuracy)) {
        $("status").textContent = geolocationErrorMessage(error);
      }
    },
    options
  );

  setTimeout(() => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }
  }, 22000);
}

function enableOrientation() {
  const getCameraPointing = (event) => {
    if (![event.alpha, event.beta, event.gamma].every((value) => typeof value === "number")) {
      return null;
    }

    const alpha = degToRad(event.webkitCompassHeading ?? event.alpha);
    const beta = degToRad(event.beta);
    const gamma = degToRad(event.gamma);
    const cA = Math.cos(alpha);
    const sA = Math.sin(alpha);
    const cB = Math.cos(beta);
    const sB = Math.sin(beta);
    const cG = Math.cos(gamma);
    const sG = Math.sin(gamma);

    const m13 = cA * sG + cG * sA * sB;
    const m23 = sA * sG - cA * cG * sB;
    const m33 = cB * cG;

    // Browser orientation describes the phone body. The back camera points
    // through the negative device Z axis, so use the negative third column.
    const east = -m13;
    const north = -m23;
    const up = -m33;
    return {
      azDeg: wrap360(radToDeg(Math.atan2(east, north))),
      altDeg: radToDeg(Math.asin(Math.max(-1, Math.min(1, up)))),
    };
  };

  const handle = (event) => {
    const pointing = getCameraPointing(event);
    if (pointing) {
      state.az = pointing.azDeg;
      state.alt = Math.max(-90, Math.min(90, pointing.altDeg));
      $("azimuth").value = state.az.toFixed(1);
      $("altitude").value = state.alt.toFixed(1);
    }
    solvePointing();
  };

  if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
    DeviceOrientationEvent.requestPermission()
      .then((response) => {
        if (response === "granted") {
          window.addEventListener("deviceorientation", handle);
          $("status").textContent = "Orientation sensors connected.";
        }
      })
      .catch(() => {
        $("status").textContent = "Orientation permission was not granted.";
      });
  } else {
    window.addEventListener("deviceorientation", handle);
    $("status").textContent = "Orientation listener enabled.";
  }
}

function objectLabel(object) {
  return `${object.id} - ${object.name}`;
}

function catalogGroup(object) {
  if (object.kind === "planet") return "planet";
  if (object.id.startsWith("M")) return "messier";
  if (object.id.startsWith("NGC")) return "ngc";
  if (object.id.startsWith("IC")) return "ic";
  if (object.id.startsWith("HD")) return "hd";
  return "object";
}

function objectTypeGroup(object) {
  const type = object.type.toLowerCase();
  if (type.includes("galaxy")) return "galaxy";
  if (type.includes("planet")) return "planet";
  if (type.includes("star") || type.includes("cluster")) return "star";
  if (type.includes("nebula") || type.includes("remnant")) return "nebula";
  return "object";
}

function filteredTargets() {
  const selectedCatalog = $("targetCatalog")?.value || "all";
  const selectedType = $("targetType")?.value || "all";
  return catalog.objects.filter((object) => {
    const groupMatches = selectedCatalog === "all" || catalogGroup(object) === selectedCatalog;
    const typeMatches = selectedType === "all" || objectTypeGroup(object) === selectedType;
    return groupMatches && typeMatches;
  });
}

function populateTargetSelectors() {
  const select = $("targetSelect");
  if (!select) return;
  const previousValue = select.value;
  const targets = filteredTargets();
  select.innerHTML = "";
  targets.forEach((object) => {
    const option = document.createElement("option");
    option.value = object.id;
    option.textContent = `${objectLabel(object)} (${object.type})`;
    select.appendChild(option);
  });
  if (targets.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No matching objects";
    select.appendChild(option);
    state.target = null;
    $("targetStatus").textContent = "No objects match this catalog/type filter.";
    solvePointing();
    return;
  }
  if (targets.some((object) => object.id === previousValue)) {
    select.value = previousValue;
  }
}

function setTarget() {
  const selectedId = $("targetSelect").value;
  const target = catalog.objects.find((object) => object.id === selectedId);
  if (!target) {
    state.target = null;
    state.guideTargetId = null;
    state.guideAzDirection = 0;
    $("targetStatus").textContent = "No target selected.";
    solvePointing();
    return;
  }
  state.target = target;
  state.guideTargetId = null;
  state.guideAzDirection = 0;
  $("targetStatus").textContent = `${target.id}: ${target.name} (${target.type})`;
  solvePointing();
}

function wireControls() {
  ["latitude", "longitude", "azimuth", "altitude", "fieldOfView", "survey"].forEach((id) => {
    $(id).addEventListener("input", solvePointing);
  });
  ["targetCatalog", "targetType"].forEach((id) => {
    $(id).addEventListener("change", () => {
      populateTargetSelectors();
      setTarget();
    });
  });
  $("targetSelect").addEventListener("change", setTarget);
  $("capture").addEventListener("click", captureSky);
  $("location").addEventListener("click", useLocation);
  $("orientation").addEventListener("click", enableOrientation);
  $("cameraToggle").addEventListener("click", startCamera);
  $("targetSet").addEventListener("click", setTarget);
  window.addEventListener("resize", () => {
    drawSkyOverlay();
  });
}

syncInputsFromState();
populateTargetSelectors();
wireControls();
solvePointing();
