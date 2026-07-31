import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureWorkspaceIdentity } from "./workspace-identity.mjs";

const root = path.resolve(import.meta.dirname, "../..");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function captureComponentVisualEvidenceIdentity({
  browser,
  page,
  evidenceClass,
  captureMatrix,
  renderIdentity = null,
  seed = "component-visual-oracle-v1",
}) {
  const [packageJson, packageLock, browserIdentity, workspace] =
    await Promise.all([
      fs.readFile(path.join(root, "package.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(root, "package-lock.json")),
      page.evaluate(() => {
        const canvas = document.querySelector("#stage canvas"),
          gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl"),
          debug = gl?.getExtension("WEBGL_debug_renderer_info"),
          performance = window.simulacrum_performance?.() || null;
        return {
          userAgent: navigator.userAgent,
          devicePixelRatio,
          viewport: { width: innerWidth, height: innerHeight },
          fonts: {
            spaceGrotesk: document.fonts.check('16px "Space Grotesk"'),
            dmSans: document.fonts.check('16px "DM Sans"'),
          },
          webgl: gl
            ? {
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
              }
            : null,
          renderer: performance?.renderer || null,
          environment:
            typeof window.render_game_to_text === "function"
              ? (() => {
                  const state = JSON.parse(window.render_game_to_text());
                  return {
                    timeOfDay: state.environment?.timeOfDay,
                    sunElevationDeg: state.environment?.sunElevationDeg,
                    spaceBlend: state.environment?.spaceBlend,
                    reflectionEnvironment:
                      state.environment?.reflectionEnvironment || null,
                  };
                })()
              : null,
        };
      }),
      captureWorkspaceIdentity(root, [
        "artifacts",
        "dist",
        "packages/core/dist",
      ]),
    ]);
  const identity = {
    evidenceContract: "component-visual-evidence-identity-v1",
    evidenceClass,
    source: workspace,
    host: {
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      cpu: os.cpus()[0]?.model || "unknown",
    },
    runtime: {
      node: process.version,
      npmUserAgent: process.env.npm_config_user_agent || null,
      packageManager: packageJson.packageManager,
      applicationVersion: packageJson.version,
      packageLockSha256: sha256(packageLock),
      playwright: (
        await import("playwright/package.json", { with: { type: "json" } })
      ).default.version,
      chromium: browser.version(),
      chromiumExecutable: browser.browserType().executablePath(),
    },
    browser: browserIdentity,
    captureMatrix,
    seed,
    render: renderIdentity,
  };
  return Object.freeze({
    identity,
    identitySha256: sha256(JSON.stringify(identity)),
  });
}

export async function writeComponentVisualEvidenceManifest({
  outputDirectory,
  evidence,
  artifacts,
}) {
  await fs.writeFile(
    path.join(outputDirectory, "capture-identity.json"),
    `${JSON.stringify(evidence.identity, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(outputDirectory, "capture-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        identitySha256: evidence.identitySha256,
        artifacts: [...artifacts].sort().map((file) => ({
          file,
          identitySha256: evidence.identitySha256,
        })),
      },
      null,
      2,
    )}\n`,
  );
}
