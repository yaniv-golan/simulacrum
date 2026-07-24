import * as THREE from "three";

function smoothstep(min, max, value) {
  const x = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
  return x * x * (3 - 2 * x);
}

function compassFromVelocity(velocity) {
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed < 0.05) return "CALM";
  const directions = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"],
    toward = (Math.atan2(velocity.z, velocity.x) * 180) / Math.PI,
    index = Math.round((((toward % 360) + 360) % 360) / 45) % 8;
  return `${speed.toFixed(1)} m/s → ${directions[index]}`;
}

function formatSolarTime(value) {
  const totalMinutes = Math.round((((value % 24) + 24) % 24) * 60),
    hours = Math.floor(totalMinutes / 60) % 24,
    minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Owns time, wind, sky, atmosphere, and celestial presentation. */
export function createEnvironmentPresentation({
  root = document,
  model,
  persistence,
  scene,
  earth,
  atmosphere,
}) {
  const $ = (selector) => root.querySelector(selector),
    nightSky = new THREE.Color(0x01040d),
    twilightSky = new THREE.Color(0xc46955),
    daySky = new THREE.Color(0x91c7d8),
    spaceSky = new THREE.Color(0x000106),
    environmentSky = new THREE.Color();

  function update() {
    const solarPhase = ((model.timeOfDay - 6) / 12) * Math.PI,
      elevationSin = Math.sin(solarPhase),
      elevationDeg = THREE.MathUtils.radToDeg(Math.asin(elevationSin)),
      azimuth = (model.timeOfDay / 24) * Math.PI * 2 - Math.PI * 0.75,
      horizontal = Math.cos(Math.asin(elevationSin)),
      solarDirection = new THREE.Vector3(
        Math.cos(azimuth) * horizontal,
        elevationSin,
        Math.sin(azimuth) * horizontal,
      ).normalize(),
      daylight = smoothstep(-5, 15, elevationDeg),
      altitude = scene.flightActive()
        ? Math.max(0, scene.machine.position.y)
        : Math.max(0, scene.cameraTarget.y - 1.2),
      spaceBlend = smoothstep(45000, scene.karmanLineM, altitude),
      groundSky =
        elevationDeg >= 0
          ? twilightSky.clone().lerp(daySky, smoothstep(0, 35, elevationDeg))
          : nightSky
              .clone()
              .lerp(twilightSky, smoothstep(-12, 0, elevationDeg));
    model.spaceBlend = spaceBlend;
    model.sunElevationDeg = elevationDeg;
    environmentSky.copy(groundSky).lerp(spaceSky, spaceBlend);
    scene.world.background.copy(environmentSky);
    scene.world.fog.color.copy(environmentSky);
    const relativeAirDensity = atmosphere.densityAt(altitude) / 1.225;
    scene.world.fog.density = 0.000085 * relativeAirDensity * (1 - spaceBlend);
    scene.sun.position
      .copy(solarDirection)
      .multiplyScalar(75)
      .add(scene.cameraTarget);
    scene.sun.target.position.copy(scene.cameraTarget);
    scene.sun.target.updateMatrixWorld();
    scene.sun.intensity = THREE.MathUtils.lerp(
      0.12 + daylight * 4.25,
      4.6,
      spaceBlend,
    );
    scene.sun.color
      .set(0xffa25f)
      .lerp(new THREE.Color(0xfff1cf), smoothstep(0, 28, elevationDeg));
    scene.hemisphere.intensity = THREE.MathUtils.lerp(
      0.9 + daylight * 1.44,
      0.08,
      spaceBlend,
    );
    scene.hemisphere.color
      .set(0x274066)
      .lerp(new THREE.Color(0xeaf9ff), daylight);
    scene.hemisphere.groundColor
      .set(0x10131b)
      .lerp(new THREE.Color(0x32483e), daylight);
    scene.ambientFill.color
      .set(0x7894c2)
      .lerp(new THREE.Color(0xffe1bb), daylight);
    scene.ambientFill.intensity = THREE.MathUtils.lerp(
      0.9 - daylight * 0.62,
      0.04,
      spaceBlend,
    );
    scene.moonLight.position.copy(solarDirection).multiplyScalar(-65);
    scene.moonLight.intensity = THREE.MathUtils.lerp(
      (1 - daylight) * 1.4,
      0.12,
      spaceBlend,
    );
    scene.renderer.toneMappingExposure = THREE.MathUtils.lerp(
      1.12 + daylight * 0.04,
      1.08,
      spaceBlend,
    );
    const astronomicalNight = 1 - smoothstep(-12, -4, elevationDeg),
      nightStars = astronomicalNight * (1 - spaceBlend);
    scene.starMaterial.opacity = Math.max(nightStars * 0.82, spaceBlend * 0.98);
    scene.moonMaterial.opacity = Math.max(
      (1 - smoothstep(-3, 25, elevationDeg)) * 0.94,
      spaceBlend,
    );
    scene.skyEnvironment.position.copy(scene.cameraTarget);
    scene.moon.position.set(0.28, 0.36, -0.89).normalize().multiplyScalar(340);
    scene.earthMaterial.opacity = spaceBlend;
    scene.atmosphereMaterial.opacity = spaceBlend * 0.38;
    scene.earthLimb.visible = scene.atmosphereShell.visible =
      spaceBlend > 0.005;
    scene.stars.visible = scene.starMaterial.opacity > 0.005;
    scene.moon.visible = scene.moonMaterial.opacity > 0.02;
    for (const cloud of scene.clouds) {
      cloud.material.color
        .set(0x758493)
        .lerp(new THREE.Color(0xffffff), daylight * 0.88);
      cloud.material.opacity =
        cloud.layer.opacity * (0.28 + daylight * 0.72) * (1 - spaceBlend);
    }
    scene.meteorite.rotation.y += 0.0009;
    scene.targetRing.rotation.z += 0.002;
    $("#time-label").textContent = formatSolarTime(model.timeOfDay);
    $("#sun-elevation").textContent = `${Math.round(elevationDeg)}°`;
    $("#sun-status").textContent =
      elevationDeg > 8 ? "DAYLIGHT" : elevationDeg > -8 ? "TWILIGHT" : "NIGHT";
    $("#surface-wind").textContent = compassFromVelocity(
      model.windAt(new THREE.Vector3(0, 10, 0)),
    );
    $("#jet-wind").textContent = compassFromVelocity(
      model.windAt(new THREE.Vector3(0, 10000, 0)),
    );
    $("#wind-enabled").checked = model.windEnabled;
    root.documentElement.style.setProperty(
      "--sky-glow",
      `#${environmentSky.getHexString()}`,
    );
  }

  function setTimeOfDay(value, persist = true) {
    model.timeOfDay = ((Number(value) % 24) + 24) % 24;
    $("#time-of-day").value = model.timeOfDay;
    if (persist) persistence.setTime(model.timeOfDay);
    update();
    scene.render();
  }

  function setWindEnabled(enabled, persist = true) {
    model.windEnabled = Boolean(enabled);
    $("#wind-enabled").checked = model.windEnabled;
    const coordinate = earth.coordinate();
    $("#earth-coordinate").textContent =
      `${coordinate.latitude.toFixed(5)}°, ${coordinate.longitude.toFixed(5)}°`;
    $("#earth-chunks").textContent = String(earth.chunkCount());
    if (persist) persistence.setWind(model.windEnabled);
    update();
  }

  return { setTimeOfDay, setWindEnabled, update };
}
