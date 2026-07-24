import { testSiteShapeWorldPoint } from "../model/test-site-shapes.js";
import {
  testSiteHeightFeatureExtrema,
  testSiteHeightFeatureShape,
} from "../model/test-site-terrain.js";

const MATERIAL_COLORS = Object.freeze({
  "short-grass": "#738e50",
  "dry-asphalt": "#3b4546",
  "wet-asphalt": "#24404a",
  "weathered-concrete": "#a7aaa1",
  "compacted-soil": "#805c3b",
  "loose-gravel": "#817e72",
  "dry-sand": "#d3b77a",
  "saturated-mud": "#493725",
  "low-grip-polymer": "#d8e9ed",
});

const MATERIAL_PATTERNS = Object.freeze({
  "short-grass": '<path d="M0 8 3 3 6 8 9 3"/>',
  "dry-asphalt":
    '<circle cx="2" cy="2" r=".7"/><circle cx="7" cy="6" r=".55"/>',
  "wet-asphalt": '<path d="M-2 8 8-2M2 12 12 2"/>',
  "weathered-concrete": '<path d="M0 5H10M5 0V10"/>',
  "compacted-soil": '<path d="M0 3H6M4 8H10"/>',
  "loose-gravel":
    '<circle cx="2" cy="3" r="1.1"/><circle cx="7" cy="7" r="1.4"/>',
  "dry-sand": '<path d="M0 3Q2.5 0 5 3T10 3M0 8Q2.5 5 5 8T10 8"/>',
  "saturated-mud": '<path d="M-2 10 10-2M4 12 12 4" stroke-width="1.5"/>',
  "low-grip-polymer": '<path d="M2 2 8 8M8 2 2 8"/>',
});

const title = (value) =>
  value
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");

function shapeElement(shape, attributes) {
  if (shape.kind === "polygon") {
    const path = shape.ringsM
      .map(
        (ring) =>
          ring
            .map((point, index) => {
              const world = testSiteShapeWorldPoint(shape, point);
              return `${index ? "L" : "M"}${world.x} ${-world.z}`;
            })
            .join(" ") + " Z",
      )
      .join(" ");
    return `<path d="${path}" fill-rule="evenodd" ${attributes}/>`;
  }
  if (shape.kind === "corridor-network") {
    const strokeAttributes = attributes.replaceAll("fill=", "stroke=");
    return shape.pathsM
      .map((path) => {
        const data = path
          .map((point, index) => {
            const world = testSiteShapeWorldPoint(shape, point);
            return `${index ? "L" : "M"}${world.x} ${-world.z}`;
          })
          .join(" ");
        return `<path d="${data}" fill="none" stroke-width="${shape.widthM}" stroke-linecap="${shape.cap}" stroke-linejoin="${shape.join}" ${strokeAttributes}/>`;
      })
      .join("");
  }
  const [x, z] = shape.centerM,
    [width, depth] = shape.sizeM;
  return shape.kind === "ellipse"
    ? `<ellipse cx="${x}" cy="${-z}" rx="${width / 2}" ry="${depth / 2}" ${attributes}/>`
    : `<rect x="${x - width / 2}" y="${-z - depth / 2}" width="${width}" height="${depth}" rx="1.5" ${attributes}/>`;
}

function shapeSvg(region) {
  const { shape } = region,
    [x, z] = shape.centerM,
    color = MATERIAL_COLORS[region.materialKey] || "#6f7b68",
    transform = `rotate(${(-shape.rotationRad * 180) / Math.PI} ${x} ${-z})`,
    patternId = `test-pattern-${region.materialKey}`,
    complex = shape.kind === "polygon" || shape.kind === "corridor-network",
    transformAttribute = complex ? "" : ` transform="${transform}"`;
  return `<g data-map-material="${region.materialKey}">${shapeElement(shape, `fill="${color}"${transformAttribute}`)}${MATERIAL_PATTERNS[region.materialKey] ? shapeElement(shape, `fill="url(#${patternId})"${transformAttribute}`) : ""}</g>`;
}

function patternDefinitions() {
  return `<defs>${Object.entries(MATERIAL_PATTERNS)
    .map(
      ([materialKey, marks]) =>
        `<pattern id="test-pattern-${materialKey}" width="10" height="10" patternUnits="userSpaceOnUse"><g fill="none" stroke="#f2fff5" stroke-width=".8" opacity=".34">${marks}</g></pattern>`,
    )
    .join(
      "",
    )}<pattern id="test-pattern-water" width="12" height="8" patternUnits="userSpaceOnUse"><path d="M0 4Q3 1 6 4T12 4" fill="none" stroke="#bcefff" stroke-width="1" opacity=".55"/></pattern></defs>`;
}

function zoneSvg(zone) {
  const { shape } = zone,
    [x, z] = shape.centerM,
    transform = `rotate(${(-shape.rotationRad * 180) / Math.PI} ${x} ${-z})`,
    attributes = `class="test-route-zone" data-test-zone="${zone.id}" transform="${transform}"`;
  if (shape.kind === "polygon" || shape.kind === "corridor-network")
    return shapeElement(
      shape,
      attributes.replace(` transform="${transform}"`, ""),
    );
  const [width, depth] = shape.sizeM;
  return shape.kind === "ellipse"
    ? `<ellipse cx="${x}" cy="${-z}" rx="${width / 2}" ry="${depth / 2}" ${attributes}/>`
    : `<rect x="${x - width / 2}" y="${-z - depth / 2}" width="${width}" height="${depth}" ${attributes}/>`;
}

function districtLabels(testSite) {
  return testSite.districts
    .map((district) => {
      const shapes = [
        ...testSite.surfaceRegions,
        ...testSite.heightFeatures.map((feature) => ({
          ...feature,
          shape: testSiteHeightFeatureShape(feature),
        })),
        ...testSite.fluidRegions,
      ].filter((entry) => entry.districtId === district.id);
      if (!shapes.length) return "";
      const x =
          shapes.reduce((sum, entry) => sum + entry.shape.centerM[0], 0) /
          shapes.length,
        z =
          shapes.reduce((sum, entry) => sum + entry.shape.centerM[1], 0) /
          shapes.length;
      return `<text x="${x}" y="${-z}" text-anchor="middle">${district.label.toUpperCase()}</text>`;
    })
    .join("");
}

function mapMarkup(testSite) {
  const [width, depth] = testSite.footprint.sizeM;
  return `<svg viewBox="${-width / 2} ${-depth / 2} ${width} ${depth}" role="img" aria-label="Test Reserve districts, surfaces, water, runway and staging pads">
    ${patternDefinitions()}
    <rect x="${-width / 2}" y="${-depth / 2}" width="${width}" height="${depth}" fill="#607b45"/>
    <rect x="${-width / 2}" y="${-depth / 2}" width="${width}" height="${depth}" fill="url(#test-pattern-short-grass)"/>
    ${testSite.heightFeatures
      .map((feature) => {
        const extrema = testSiteHeightFeatureExtrema(feature);
        return shapeSvg({
          ...feature,
          shape: testSiteHeightFeatureShape(feature),
          materialKey:
            Math.abs(extrema.minimumM) > extrema.maximumM
              ? "saturated-mud"
              : "short-grass",
        });
      })
      .join("")}
    ${testSite.surfaceRegions.map(shapeSvg).join("")}
    ${testSite.fluidRegions.map((fluid) => `${shapeElement(fluid.shape, 'fill="#2b7d8c"')}${shapeElement(fluid.shape, 'fill="url(#test-pattern-water)"')}`).join("")}
    ${testSite.zones.map(zoneSvg).join("")}
    <rect x="-22" y="-22" width="44" height="44" fill="#173538" stroke="#72dfc8" stroke-width="1.5"/>
    ${testSite.stagingPads.map((pad) => `<circle cx="${pad.pose.positionM[0]}" cy="${-pad.pose.positionM[2]}" r="4" class="staging-pad"><title>${title(pad.id)} staging pad</title></circle>`).join("")}
    <g id="test-reserve-machine" aria-label="Current machine position"><circle r="5.5"/><path d="M -7 0 L 7 0 M 0 -7 L 0 7"/></g>
    ${districtLabels(testSite)}
  </svg>`;
}

/** Renders and binds the optional Test Reserve map without owning mutations. */
export function createTestReservePanel({
  root = document,
  testSite,
  isRunning,
  machinePosition,
  activeRouteId,
  onFreeTest,
  onRetry,
  courseView,
  onDeploy,
  onTrial,
}) {
  const query = (selector) => root.querySelector(selector),
    buttons = (selector) =>
      Array.from(
        root.querySelectorAll(selector),
        (element) => /** @type {HTMLButtonElement} */ (element),
      ),
    zones = (selector) =>
      Array.from(
        root.querySelectorAll(selector),
        (element) => /** @type {SVGElement} */ (element),
      ),
    panel = query(".test-reserve-browser"),
    status = query("#test-reserve-status"),
    opener = query("#test-reserve-btn"),
    retry = query("#test-reserve-retry");
  let restoreFocus = null;
  query("#test-reserve-map").innerHTML = mapMarkup(testSite);
  query("#test-reserve-legend").innerHTML = Object.entries(MATERIAL_COLORS)
    .map(
      ([key, color]) =>
        `<span><i style="background:${color}"></i>${title(key)}</span>`,
    )
    .join("");
  query("#test-reserve-pads").innerHTML = testSite.stagingPads
    .filter(({ id }) => id !== "board")
    .map((pad) => `<button data-test-pad="${pad.id}">${title(pad.id)}</button>`)
    .join("");
  const renderRoutes = () => {
    query("#test-reserve-routes").innerHTML = testSite.routes
      .map((route) => {
        const records = courseView(route.id).reliability,
          recordLabel = records.attempts
            ? `${records.bestTimeS?.toFixed(2) || "—"} s best · ${Math.round(records.reliability * 100)}% · ${records.attempts} runs`
            : "No compatible runs";
        return `<button data-test-route="${route.id}" aria-pressed="false">${route.label}<small>${title(route.stagingPadId)} pad · ${recordLabel}</small></button>`;
      })
      .join("");
    for (const button of buttons("[data-test-route]"))
      button.onclick = () => {
        if (onTrial(button.dataset.testRoute, setStatus))
          showRoute(button.dataset.testRoute);
      };
  };
  renderRoutes();
  const updateMachineMarker = () => {
      const marker = query("#test-reserve-machine"),
        position = machinePosition();
      marker.setAttribute(
        "transform",
        `translate(${position.x} ${-position.z})`,
      );
    },
    showRoute = (routeId) => {
      const route = testSite.routes.find(({ id }) => id === routeId),
        gateIds = new Set(route?.gateIds || []);
      for (const zone of zones("[data-test-zone]"))
        zone.classList.toggle("active", gateIds.has(zone.dataset.testZone));
      for (const button of buttons("[data-test-route]")) {
        button.classList.toggle("active", button.dataset.testRoute === routeId);
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.testRoute === routeId),
        );
      }
    },
    close = ({ returnFocus = true } = {}) => {
      panel.classList.add("hidden");
      panel.setAttribute("aria-hidden", "true");
      opener.setAttribute("aria-expanded", "false");
      const focusTarget =
        restoreFocus?.isConnected && restoreFocus !== document.body
          ? restoreFocus
          : opener;
      if (returnFocus) focusTarget.focus();
      restoreFocus = null;
    },
    open = () => {
      for (const selector of [
        ".learn-center",
        ".demo-browser",
        ".challenge-browser",
        ".environment-panel",
        ".remote-console",
        ".wasm-console",
        ".local-data-panel",
        ".discovery-coach",
      ])
        root.querySelector(selector)?.classList.add("hidden");
      status.textContent = isRunning()
        ? "RUNNING · STOP BEFORE DEPLOYING"
        : "READY · CHOOSE CURRENT POSITION OR A PAD";
      restoreFocus = document.activeElement;
      renderRoutes();
      for (const button of buttons("[data-test-pad]"))
        button.disabled = isRunning();
      for (const button of buttons("[data-test-route]"))
        button.disabled = isRunning();
      retry.disabled = !isRunning() || !activeRouteId();
      updateMachineMarker();
      showRoute(activeRouteId());
      panel.classList.remove("hidden");
      panel.setAttribute("aria-hidden", "false");
      opener.setAttribute("aria-expanded", "true");
      query("#close-test-reserve").focus();
    },
    setStatus = (message) => {
      status.textContent = message;
    };
  opener.setAttribute("aria-controls", panel.id);
  opener.setAttribute("aria-expanded", "false");
  opener.onclick = () =>
    panel.classList.contains("hidden") ? open() : close();
  query("#close-test-reserve").onclick = close;
  query("#test-reserve-free").onclick = () => {
    close({ returnFocus: false });
    onFreeTest();
  };
  retry.onclick = async () => {
    if (!isRunning() || !activeRouteId()) {
      setStatus("START AN ARMED TRIAL BEFORE RETRYING");
      return;
    }
    retry.disabled = true;
    setStatus("RESTORING EXACT PRE-TEST BUILD…");
    await onRetry();
    setStatus("RESTORED · SAME BUILD, PLACEMENT, SITE AND ROUTE");
  };
  for (const button of buttons("[data-test-pad]"))
    button.onclick = () => {
      if (onDeploy(button.dataset.testPad, setStatus)) updateMachineMarker();
    };
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  });
  return Object.freeze({ open, close, setStatus });
}
