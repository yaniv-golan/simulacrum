/* global document, navigator, structuredClone, window */
import * as THREE from "three";
import { TYPES } from "../../src/model/component-catalog.js";
import { componentMesh } from "../../src/presentation/component-mesh-factory.js";
import { disposeObject3D } from "../../src/presentation/render-resources.js";

export const catalogTypes = Object.freeze(Object.keys(TYPES).sort());

export function installComponentCatalogTurntable() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }),
    scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000),
    hemisphere = new THREE.HemisphereLight(0xdff7ff, 0x263738, 2.4),
    key = new THREE.DirectionalLight(0xffffff, 3.2),
    fill = new THREE.DirectionalLight(0x9fd7ff, 1.4);
  renderer.setSize(512, 512, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.domElement.id = "component-catalog-turntable";
  Object.assign(renderer.domElement.style, {
    position: "fixed",
    inset: "0",
    width: "512px",
    height: "512px",
    zIndex: "20000",
  });
  document.body.append(renderer.domElement);
  key.position.set(4, 6, 7);
  fill.position.set(-5, 2, 4);
  scene.add(hemisphere, key, fill);
  let current = null;

  function render(type, lighting) {
    if (current) disposeObject3D(current);
    current = componentMesh(type, undefined, "hero");
    current.rotation.set(-0.22, 0.62, 0);
    current.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(current),
      center = bounds.getCenter(new THREE.Vector3()),
      size = bounds.getSize(new THREE.Vector3()),
      radius = Math.max(0.05, size.length() / 2);
    current.position.sub(center);
    camera.position.set(0, radius * 0.12, radius * 3.6);
    camera.near = Math.max(0.001, radius / 100);
    camera.far = radius * 20;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    if (lighting === "night") {
      scene.background = new THREE.Color(0x071316);
      hemisphere.intensity = 0.55;
      key.intensity = 2.2;
      fill.intensity = 0.5;
    } else {
      scene.background = new THREE.Color(0x9baba5);
      hemisphere.intensity = 2.4;
      key.intensity = 3.2;
      fill.intensity = 1.4;
    }
    scene.add(current);
    renderer.render(scene, camera);
    return {
      type,
      lighting,
      detailTier: "hero",
      renderedSizeM: size.toArray(),
      descriptor: structuredClone(current.userData.geometryDescriptor),
      renderer: {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        colorSpace: renderer.outputColorSpace,
        toneMapping: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
      },
    };
  }

  function identity() {
    const gl = renderer.getContext();
    return {
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      viewport: [512, 512],
      webglVersion: gl.getParameter(gl.VERSION),
      webglRenderer: gl.getParameter(gl.RENDERER),
      webglVendor: gl.getParameter(gl.VENDOR),
    };
  }

  function dispose() {
    if (current) disposeObject3D(current);
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { canvas: renderer.domElement, dispose, identity, render };
}
