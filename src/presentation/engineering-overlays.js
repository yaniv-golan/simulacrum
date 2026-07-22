import * as THREE from "three";
import { analyzeAssembly } from "../model/engineering-analysis.js";

function marker(color) {
  const group = new THREE.Group(),
    material = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 12), material));
  for (const rotation of [
    [Math.PI / 2, 0, 0],
    [0, Math.PI / 2, 0],
    [0, 0, 0],
  ]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.018, 8, 48),
      material,
    );
    ring.rotation.set(...rotation);
    group.add(ring);
  }
  group.renderOrder = 50;
  return group;
}

/** Presents pure assembly analysis without mutating the editor or simulation. */
export function installEngineeringOverlays({
  root = document,
  machine,
  effects,
  catalog,
  getSnapshot,
  getParts,
  onOpen = () => {},
}) {
  const $ = (selector) => root.querySelector(selector);
  $("#environment-btn").insertAdjacentHTML(
    "afterend",
    '<button id="engineering-btn">⌖ <span>ENGINEERING<em>Mass, buoyancy & clearance</em></span></button>',
  );
  catalog.insertAdjacentHTML(
    "afterend",
    `<aside class="engineering-panel glass hidden"><div class="engineering-head"><div><small>BUILD ANALYSIS</small><h2>Engineering overlays</h2></div><button id="close-engineering" aria-label="Close engineering overlays">×</button></div><p class="engineering-intro">Inspect the ordinary component geometry and material model. Overlays never change the machine.</p><div class="engineering-toggle-grid"><button data-engineering-overlay="com" class="active"><i class="com"></i><span><b>CENTER OF MASS</b><small>Mass-weighted balance point</small></span></button><button data-engineering-overlay="cob"><i class="cob"></i><span><b>CENTER OF BUOYANCY</b><small>Full-submersion displacement</small></span></button><button data-engineering-overlay="thrust" class="active"><i class="thrust"></i><span><b>THRUST AXIS</b><small>Nominal engine force line</small></span></button><button data-engineering-overlay="interference"><i class="interference"></i><span><b>INTERFERENCE</b><small>Unconnected solid overlap</small></span></button></div><div class="engineering-readout"><span><b id="analysis-mass">0 kg</b><small>TOTAL MASS</small></span><span><b id="analysis-volume">0 L</b><small>DISPLACEMENT</small></span><span><b id="analysis-thrust">0 kN</b><small>NOMINAL THRUST</small></span><span><b id="analysis-interference">0</b><small>INTERFERENCES</small></span></div><div class="engineering-legend"><span><i class="com"></i> COM</span><span><i class="cob"></i> COB</span><span><i class="thrust"></i> FORCE</span><span><i class="interference"></i> CLASH</span></div></aside>`,
  );
  const panel = $(".engineering-panel"),
    overlayGroup = new THREE.Group(),
    modes = { com: true, cob: false, thrust: true, interference: false };
  overlayGroup.name = "engineeringOverlays";
  machine.add(overlayGroup);
  let interferenceHelpers = [],
    lastAnalysis = analyzeAssembly({ parts: [], connections: [] }, {}),
    running = false;

  function clear() {
    for (const child of [...overlayGroup.children]) {
      overlayGroup.remove(child);
      child.traverse((object) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material))
          object.material.forEach((material) => material.dispose());
        else object.material?.dispose();
      });
    }
    for (const helper of interferenceHelpers) {
      effects.remove(helper);
      helper.geometry?.dispose();
      helper.material?.dispose();
    }
    interferenceHelpers = [];
  }

  function refresh() {
    clear();
    const snapshot = getSnapshot();
    lastAnalysis = analyzeAssembly(snapshot, snapshot.catalog);
    $("#analysis-mass").textContent = `${lastAnalysis.totalMass.toFixed(1)} kg`;
    $("#analysis-volume").textContent =
      `${(lastAnalysis.displacedVolumeM3 * 1000).toFixed(1)} L`;
    $("#analysis-thrust").textContent =
      `${(lastAnalysis.thrust.forceN / 1000).toFixed(1)} kN`;
    $("#analysis-interference").textContent = String(
      lastAnalysis.interferences.length,
    );
    const panelOpen = !panel.classList.contains("hidden");
    overlayGroup.visible = !running && panelOpen;
    if (running || !panelOpen) return lastAnalysis;
    if (modes.com && snapshot.parts.length) {
      const com = marker(0xffc65d);
      com.name = "centerOfMassOverlay";
      com.position.set(...lastAnalysis.centerOfMass);
      overlayGroup.add(com);
    }
    if (modes.cob && snapshot.parts.length) {
      const cob = marker(0x55d8ff);
      cob.name = "centerOfBuoyancyOverlay";
      cob.position.set(...lastAnalysis.centerOfBuoyancy);
      overlayGroup.add(cob);
    }
    if (modes.thrust && lastAnalysis.thrust.forceN > 0) {
      const direction = new THREE.Vector3(...lastAnalysis.thrust.direction),
        origin = new THREE.Vector3(...lastAnalysis.thrust.origin),
        visibleLength = THREE.MathUtils.clamp(
          lastAnalysis.thrust.forceN / 5000,
          2.5,
          12,
        ),
        axis = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            origin.clone().addScaledVector(direction, -visibleLength * 0.6),
            origin.clone().addScaledVector(direction, visibleLength * 1.4),
          ]),
          new THREE.LineDashedMaterial({
            color: 0xff7b54,
            dashSize: 0.22,
            gapSize: 0.12,
            depthTest: false,
          }),
        ),
        arrow = new THREE.ArrowHelper(
          direction,
          origin,
          visibleLength,
          0xff7b54,
          0.55,
          0.28,
        );
      axis.computeLineDistances();
      axis.name = "thrustAxisOverlay";
      arrow.name = "thrustVectorOverlay";
      overlayGroup.add(axis, arrow);
    }
    if (modes.interference) {
      const clashing = new Set(
        lastAnalysis.interferences.flatMap(({ a, b }) => [a, b]),
      );
      for (const part of getParts().filter((candidate) =>
        clashing.has(candidate.id),
      )) {
        const helper = new THREE.BoxHelper(part.mesh, 0xff4f62);
        helper.name = "interferenceOverlay";
        helper.material.depthTest = false;
        helper.material.transparent = true;
        helper.material.opacity = 0.95;
        effects.add(helper);
        interferenceHelpers.push(helper);
      }
    }
    return lastAnalysis;
  }

  function open() {
    panel.classList.remove("hidden");
    catalog.classList.add("engineering-replaced");
    $(".environment-panel")?.classList.add("hidden");
    $(".remote-console")?.classList.add("hidden");
    onOpen();
    refresh();
  }
  function close() {
    panel.classList.add("hidden");
    catalog.classList.remove("engineering-replaced");
    clear();
  }

  $("#engineering-btn").onclick = open;
  $("#close-engineering").onclick = close;
  globalThis
    .matchMedia("(max-width: 1080px)")
    .addEventListener("change", (event) => {
      if (event.matches && !panel.classList.contains("hidden")) onOpen();
    });
  panel.querySelectorAll("[data-engineering-overlay]").forEach((button) => {
    button.onclick = () => {
      const mode = button.dataset.engineeringOverlay;
      modes[mode] = !modes[mode];
      button.classList.toggle("active", modes[mode]);
      refresh();
    };
  });
  return {
    close,
    open,
    refresh,
    setRunning(active) {
      running = !!active;
      overlayGroup.visible = !running;
      for (const helper of interferenceHelpers) helper.visible = !running;
    },
    snapshot() {
      return {
        open: !panel.classList.contains("hidden"),
        modes: { ...modes },
        analysis: structuredClone(lastAnalysis),
      };
    },
  };
}
