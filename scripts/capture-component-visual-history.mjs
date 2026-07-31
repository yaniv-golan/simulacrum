import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.PHASE0_BASE_URL;
if (!baseUrl) throw new Error("PHASE0_BASE_URL is required");
const sourceRoot = path.resolve(process.env.PHASE0_SOURCE_ROOT || "."),
  sourceRevision = process.env.PHASE0_SOURCE_REVISION;
if (!sourceRevision) throw new Error("PHASE0_SOURCE_REVISION is required");
const outputDirectory = path.resolve(
  process.env.PHASE0_OUTPUT_DIRECTORY ||
    "artifacts/component-visual-realism/phase0-track-a-baseline",
);
await fs.mkdir(outputDirectory, { recursive: true });

const [packageJson, packageLock] = await Promise.all([
    fs.readFile(path.join(sourceRoot, "package.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(sourceRoot, "package-lock.json")),
  ]),
  browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  }),
  page = await browser.newPage({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1,
  }),
  errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("requestfailed", (request) =>
  errors.push(
    `request: ${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`,
  ),
);
await page.goto(`${baseUrl}/phase0-capture.html`, {
  waitUntil: "domcontentloaded",
});

const types = await page.evaluate(async (runtimeBaseUrl) => {
    const module = await import(
      `${runtimeBaseUrl}/src/model/component-catalog.js`
    );
    return Object.keys(module.TYPES).sort();
  }, baseUrl),
  artifactFiles = [];
let browserIdentity = null;
for (const type of types) {
  for (const lighting of ["day", "night"]) {
    const record = await page.evaluate(
      async ({
        type: componentType,
        lighting: lightPreset,
        runtimeBaseUrl,
      }) => {
        const THREE = await import(
            `${runtimeBaseUrl}/node_modules/three/build/three.module.js`
          ),
          { componentMesh } = await import(
            `${runtimeBaseUrl}/src/presentation/component-mesh-factory.js`
          );
        window.__historicalTurntable?.dispose();
        document.body.innerHTML = "";
        document.body.style.margin = "0";
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 512;
        canvas.style.width = "512px";
        canvas.style.height = "512px";
        document.body.append(canvas);
        const renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            preserveDrawingBuffer: true,
          }),
          scene = new THREE.Scene(),
          camera = new THREE.PerspectiveCamera(36, 1, 0.05, 100),
          root = new THREE.Group(),
          mesh = componentMesh(componentType, undefined, "standard");
        renderer.setSize(512, 512, false);
        renderer.setPixelRatio(1);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = lightPreset === "day" ? 1 : 0.88;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        scene.background = new THREE.Color(
          lightPreset === "day" ? 0xa5b3b0 : 0x10191c,
        );
        root.add(mesh);
        const bounds = new THREE.Box3().setFromObject(mesh),
          center = bounds.getCenter(new THREE.Vector3());
        mesh.position.sub(center);
        root.rotation.set(-0.22, 0.58, 0.08);
        scene.add(root);
        camera.position.set(3.3, 2.4, 4.35).setLength(6);
        camera.lookAt(0, 0, 0);
        scene.add(
          new THREE.HemisphereLight(
            lightPreset === "day" ? 0xe4f5f1 : 0x708ca0,
            lightPreset === "day" ? 0x34443f : 0x090d10,
            lightPreset === "day" ? 2.1 : 0.55,
          ),
        );
        const key = new THREE.DirectionalLight(
          lightPreset === "day" ? 0xfff0d2 : 0x8bb7ff,
          lightPreset === "day" ? 4.1 : 2.1,
        );
        key.position.set(4, 6, 5);
        key.castShadow = true;
        scene.add(key);
        const fill = new THREE.DirectionalLight(
          lightPreset === "day" ? 0x8ec9d0 : 0xffb56c,
          lightPreset === "day" ? 1.1 : 1.35,
        );
        fill.position.set(-4, 1, -3);
        scene.add(fill);
        renderer.render(scene, camera);
        const gl = renderer.getContext(),
          debug = gl.getExtension("WEBGL_debug_renderer_info"),
          projectedBounds = new THREE.Box3().setFromObject(root);
        let drawCalls = 0,
          triangles = 0;
        root.traverse((object) => {
          if (!object.isMesh) return;
          drawCalls++;
          triangles += object.geometry.index
            ? object.geometry.index.count / 3
            : (object.geometry.attributes.position?.count || 0) / 3;
        });
        const result = {
          componentType,
          lighting: lightPreset,
          cameraDistanceM: camera.position.length(),
          detailTier: "standard",
          descriptor: structuredClone(mesh.userData.geometryDescriptor),
          projection: structuredClone(mesh.userData.geometryProjection),
          renderedBoundsM: {
            minimumM: projectedBounds.min.toArray(),
            maximumM: projectedBounds.max.toArray(),
          },
          metrics: { drawCalls, triangles },
          renderer: {
            outputColorSpace: renderer.outputColorSpace,
            toneMapping: renderer.toneMapping,
            toneMappingExposure: renderer.toneMappingExposure,
            shadows: renderer.shadowMap.enabled,
          },
          webgl: {
            version: gl.getParameter(gl.VERSION),
            shadingLanguageVersion: gl.getParameter(
              gl.SHADING_LANGUAGE_VERSION,
            ),
            vendor: gl.getParameter(gl.VENDOR),
            renderer: gl.getParameter(gl.RENDERER),
            unmaskedVendor: debug
              ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
              : null,
            unmaskedRenderer: debug
              ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
              : null,
          },
        };
        window.__historicalTurntable = {
          dispose() {
            root.traverse((object) => {
              object.geometry?.dispose();
              const materials = Array.isArray(object.material)
                ? object.material
                : [object.material];
              for (const material of materials) material?.dispose();
            });
            renderer.dispose();
          },
        };
        return result;
      },
      { type, lighting, runtimeBaseUrl: baseUrl },
    );
    browserIdentity ||= {
      viewport: { width: 512, height: 512 },
      devicePixelRatio: 1,
      userAgent: await page.evaluate(() => navigator.userAgent),
      chromium: browser.version(),
      chromiumExecutable: browser.browserType().executablePath(),
      webgl: record.webgl,
    };
    const stem = `${type}-${lighting}`;
    await page.locator("canvas").screenshot({
      path: path.join(outputDirectory, `${stem}.png`),
    });
    await fs.writeFile(
      path.join(outputDirectory, `${stem}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    artifactFiles.push(`${stem}.png`, `${stem}.json`);
  }
  console.log(`captured historical ${type}`);
}

await browser.close();
const identity = {
    evidenceContract: "component-visual-phase0-history-v1",
    evidenceClasses: {
      descriptor: "deterministic-historical-model-descriptor",
      browser: "historical-browser-projection",
      visual: "fixed-metric-human-review-capture",
      timing: "non-budget-diagnostic-only",
      environment: "recorded-host-and-renderer",
    },
    source: {
      revision: sourceRevision,
      reconstruction: "clean git archive",
    },
    runtime: {
      node: process.version,
      packageManager: packageJson.packageManager,
      applicationVersion: packageJson.version,
      packageLockSha256: crypto
        .createHash("sha256")
        .update(packageLock)
        .digest("hex"),
    },
    host: {
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      cpu: os.cpus()[0]?.model || "unknown",
    },
    browser: browserIdentity,
    capture: {
      typeCount: types.length,
      lighting: ["day", "night"],
      cameraDistanceM: 6,
      detailTier: "standard",
      seed: "component-visual-phase0-history-v1",
    },
  },
  identitySha256 = crypto
    .createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex");
await fs.writeFile(
  path.join(outputDirectory, "capture-identity.json"),
  `${JSON.stringify(identity, null, 2)}\n`,
);
await fs.writeFile(
  path.join(outputDirectory, "capture-manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      identitySha256,
      artifacts: artifactFiles.sort().map((file) => ({
        file,
        identitySha256,
      })),
      errors,
    },
    null,
    2,
  )}\n`,
);
if (errors.length)
  throw new Error(`historical capture browser errors:\n${errors.join("\n")}`);
console.log(
  `historical component baseline captured (${types.length * 2} views at ${outputDirectory})`,
);
