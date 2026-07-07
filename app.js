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
};

const $ = (id) => document.getElementById(id);
const catalog = window.ASTRO_CATALOG || { objects: [], constellations: [] };

const degToRad = (deg) => (deg * Math.PI) / 180;
const radToDeg = (rad) => (rad * 180) / Math.PI;
const wrap360 = (deg) => ((deg % 360) + 360) % 360;
const signedDeltaDeg = (toDeg, fromDeg) => {
  const delta = wrap360(toDeg - fromDeg);
  return delta > 180 ? delta - 360 : delta;
};

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

function projectToFrame(raDeg, decDeg, center = state.centerCoords) {
  if (!center) return null;
  const frame = $("skyOverlay");
  const width = frame.width;
  const height = frame.height;
  const fov = Math.max(0.1, state.fov);
  const dxDeg = signedDeltaDeg(raDeg, center.raDeg) * Math.cos(degToRad(center.decDeg));
  const dyDeg = decDeg - center.decDeg;
  const x = width / 2 + (dxDeg / fov) * width;
  const y = height / 2 - (dyDeg / fov) * height;
  const margin = 48;
  if (x < -margin || x > width + margin || y < -margin || y > height + margin) return null;
  return { x, y };
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

function drawSkyOverlay() {
  sizeOverlayCanvas();
  const canvas = $("skyOverlay");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.centerCoords) return;

  const showConstellations = $("showConstellations")?.checked;
  const showObjects = $("showObjects")?.checked;
  ctx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
  ctx.font = `${12 * (window.devicePixelRatio || 1)}px system-ui, sans-serif`;

  if (showConstellations) {
    ctx.strokeStyle = "rgba(104, 210, 198, 0.55)";
    ctx.fillStyle = "rgba(104, 210, 198, 0.78)";
    catalog.constellations.forEach((constellation) => {
      let labelPoint = null;
      constellation.lines.forEach(([from, to]) => {
        const a = constellation.stars[from];
        const b = constellation.stars[to];
        if (!a || !b) return;
        const pa = projectToFrame(a[0], a[1]);
        const pb = projectToFrame(b[0], b[1]);
        if (!pa || !pb) return;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
        labelPoint = labelPoint || pa;
      });
      if (labelPoint) ctx.fillText(constellation.name, labelPoint.x + 8, labelPoint.y - 8);
    });
  }

  if (showObjects) {
    catalog.objects.forEach((object) => {
      const distance = angularDistanceDeg(state.centerCoords.raDeg, state.centerCoords.decDeg, object.ra, object.dec);
      if (distance > state.fov * 0.85) return;
      const point = projectToFrame(object.ra, object.dec);
      if (!point) return;
      const radius = Math.max(10, Math.min(34, (object.size / state.fov) * canvas.width * 0.5));
      ctx.strokeStyle = object === state.target ? "rgba(255, 202, 95, 0.98)" : "rgba(255, 202, 95, 0.78)";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(object.id, point.x + radius + 5, point.y - radius);
    });
  }
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
  $("pointingValue").textContent = `Az ${state.az.toFixed(1)} deg, Alt ${state.alt.toFixed(1)} deg`;
}

function updateGuide(coords) {
  const arrows = {
    up: $("guideUp"),
    right: $("guideRight"),
    down: $("guideDown"),
    left: $("guideLeft"),
  };
  Object.values(arrows).forEach((arrow) => {
    arrow.style.opacity = 0;
  });
  $("targetDot").style.opacity = 0;

  if (!state.target) {
    $("guideValue").textContent = "No target";
    $("guideHint").textContent = "Search for a target.";
    return;
  }

  const targetAltAz = equatorialToHorizontal({
    raDeg: state.target.ra,
    decDeg: state.target.dec,
    latDeg: state.lat,
    lonDeg: state.lon,
  });
  const deltaAz = signedDeltaDeg(targetAltAz.azDeg, state.az);
  const deltaAlt = targetAltAz.altDeg - state.alt;
  const distance = Math.hypot(deltaAz * Math.cos(degToRad(state.alt)), deltaAlt);
  const centerThreshold = Math.max(0.4, state.fov * 0.14);

  $("guideValue").textContent = `${state.target.id}: ${distance.toFixed(1)} deg away`;
  $("guideHint").textContent =
    distance <= centerThreshold
      ? "Target centered. Resolve sky for detail."
      : `${deltaAz > 0 ? "Turn right" : "Turn left"} ${Math.abs(deltaAz).toFixed(1)} deg, ${deltaAlt > 0 ? "tilt up" : "tilt down"} ${Math.abs(deltaAlt).toFixed(1)} deg`;

  if (Math.abs(deltaAlt) > centerThreshold) {
    (deltaAlt > 0 ? arrows.up : arrows.down).style.opacity = 1;
  }
  if (Math.abs(deltaAz) > centerThreshold) {
    (deltaAz > 0 ? arrows.right : arrows.left).style.opacity = 1;
  }

  const dot = $("targetDot");
  const frame = $("skyOverlay");
  const x = 50 + (deltaAz / Math.max(state.fov, 1)) * 35;
  const y = 50 - (deltaAlt / Math.max(state.fov, 1)) * 35;
  dot.style.left = `${Math.max(8, Math.min(92, x))}%`;
  dot.style.top = `${Math.max(8, Math.min(92, y))}%`;
  dot.style.opacity = 1;
  frame.dataset.targetDistance = String(distance);
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
  const coords = solvePointing();
  const url = skyViewUrl(coords.raDeg, coords.decDeg);
  const image = $("skyImage");
  image.src = url;
  image.addEventListener("load", drawSkyOverlay, { once: true });
  state.centerCoords = coords;
  drawSkyOverlay();
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

function useLocation() {
  if (!navigator.geolocation) {
    $("status").textContent = "This browser does not expose geolocation.";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.lat = position.coords.latitude;
      state.lon = position.coords.longitude;
      syncInputsFromState();
      solvePointing();
      $("status").textContent = "Location loaded.";
    },
    () => {
      $("status").textContent = "Location permission was not granted.";
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
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

function populateTargetSearch() {
  const options = $("targetOptions");
  if (!options) return;
  options.innerHTML = "";
  catalog.objects.forEach((object) => {
    const option = document.createElement("option");
    option.value = objectLabel(object);
    options.appendChild(option);
  });
}

function findTarget(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  return catalog.objects.find((object) => {
    const fields = [object.id, object.name, object.type, objectLabel(object)].map((value) => value.toLowerCase());
    return fields.some((value) => value === normalized || value.includes(normalized));
  });
}

function setTarget() {
  const target = findTarget($("targetSearch").value);
  if (!target) {
    $("targetStatus").textContent = "No catalog match found.";
    return;
  }
  state.target = target;
  $("targetSearch").value = objectLabel(target);
  $("targetStatus").textContent = `${target.id}: ${target.name} (${target.type})`;
  solvePointing();
}

function wireControls() {
  ["latitude", "longitude", "azimuth", "altitude", "fieldOfView", "survey"].forEach((id) => {
    $(id).addEventListener("input", solvePointing);
  });
  ["showObjects", "showConstellations"].forEach((id) => {
    $(id).addEventListener("change", drawSkyOverlay);
  });
  $("capture").addEventListener("click", captureSky);
  $("location").addEventListener("click", useLocation);
  $("orientation").addEventListener("click", enableOrientation);
  $("cameraToggle").addEventListener("click", startCamera);
  $("targetSet").addEventListener("click", setTarget);
  $("targetSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") setTarget();
  });
  window.addEventListener("resize", drawSkyOverlay);
}

syncInputsFromState();
populateTargetSearch();
wireControls();
solvePointing();
