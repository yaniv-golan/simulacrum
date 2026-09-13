import * as THREE from 'three';
import { CAMERA, opticalFrame } from '../model/camera.mjs';
import { partPrimitives, shaftSegments, CYLINDER_SEGMENTS } from '../model/geometry.mjs';
import { BUILD_ENVIRONMENT, environmentObstacles } from '../model/environment.mjs';
const colors = { aluminium: 0x879eaa, steel: 0x667786, rubber: 0x303b42 };
/** Dedicated optical scene: canonical solids and exposed shafts, opaque two-sided surfaces.
 * No editor meshes, labels, exploded transforms, selection or lighting adaptation enter it.
 */
export function createCameraRenderer({
  onContext = () => {},
  createRenderer = () => new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }),
} = {}) {
  const renderer = createRenderer();
  onContext(renderer.getContext());
  renderer.setPixelRatio(1);
  renderer.setSize(CAMERA.width, CAMERA.height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb8cedc);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x657381, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(3, 6, 4);
  scene.add(light);
  const group = new THREE.Group();
  scene.add(group);
  const camera = new THREE.PerspectiveCamera(
    THREE.MathUtils.radToDeg(
      2 *
        Math.atan(
          (Math.tan(THREE.MathUtils.degToRad(CAMERA.horizontalFov) / 2) * CAMERA.height) /
            CAMERA.width,
        ),
    ),
    CAMERA.width / CAMERA.height,
    CAMERA.near,
    CAMERA.far,
  );
  let key = '',
    parts = [],
    disposed = false,
    last = null,
    lastEncoding = null;
  function clear() {
    group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) o.material.dispose();
    });
    group.clear();
    parts = [];
  }
  function solid(shape, half, color) {
    const geometry =
      shape === 'sphere'
        ? new THREE.SphereGeometry(half[1], 32, 24)
        : shape === 'cylinder'
          ? new THREE.CylinderGeometry(half[1], half[1], half[0] * 2, CYLINDER_SEGMENTS).rotateZ(
              -Math.PI / 2,
            )
          : new THREE.BoxGeometry(...half.map((v) => v * 2));
    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide }),
    );
  }
  function render(frame, node) {
    const started = performance.now();
    if (disposed) throw Error('Camera unavailable');
    if (renderer.getContext().isContextLost()) throw Error('Camera context lost');
    const bp = frame.blueprint,
      nextKey = JSON.stringify(bp);
    if (nextKey !== key) {
      clear();
      key = nextKey;
      for (const part of bp.parts) {
        const body = new THREE.Group();
        for (const p of partPrimitives(part)) {
          const m = solid(
            p.kind,
            p.halfExtents,
            colors[part.authoredMaterial[p.id] ?? p.materialKey],
          );
          m.position.fromArray(p.position);
          m.quaternion.fromArray(p.rotation);
          body.add(m);
        }
        for (const shaft of shaftSegments(part)) {
          const m = solid('cylinder', [shaft.length / 2, 0.006, 0.006], colors.steel);
          m.position.fromArray(shaft.position);
          m.quaternion.fromArray(shaft.rotation);
          body.add(m);
        }
        group.add(body);
        parts.push(body);
      }
      const ground = solid('box', BUILD_ENVIRONMENT.ground.halfExtents, 0x71878d);
      ground.position.fromArray(BUILD_ENVIRONMENT.ground.position);
      group.add(ground);
      for (const obstacle of environmentObstacles(bp.environment)) {
        const mesh = solid(obstacle.shape, obstacle.halfExtents, 0x71878d);
        mesh.position.fromArray(obstacle.position);
        mesh.quaternion.fromArray(obstacle.rotation);
        group.add(mesh);
      }
    }
    parts.forEach((m, i) => {
      m.position.fromArray(frame.physics[i].position);
      m.quaternion.fromArray(frame.physics[i].rotation);
      m.visible = i !== node;
    });
    const optics = opticalFrame(frame.physics[node]);
    camera.position.fromArray(optics.position);
    camera.up.fromArray(optics.up);
    camera.lookAt(
      new THREE.Vector3()
        .fromArray(optics.position)
        .add(new THREE.Vector3().fromArray(optics.forward)),
    );
    renderer.render(scene, camera);
    if (renderer.getContext().isContextLost()) throw Error('Camera context lost');
    last = {
      tick: frame.tick,
      node,
      body: frame.physics[node],
      optics,
      cameraPosition: camera.position.toArray(),
      cameraForward: camera.getWorldDirection(new THREE.Vector3()).toArray(),
      submissionMs: performance.now() - started,
    };
    return renderer.domElement;
  }
  return Object.freeze({
    render,
    canvas: renderer.domElement,
    encode(packet) {
      const started = performance.now();
      const source = render(packet.frame, packet.node);
      const rasterEnd = performance.now();
      // Synchronous copy pins pixels before a later camera render or delayed encoder callback.
      const canvas = document.createElement('canvas');
      canvas.width = CAMERA.width;
      canvas.height = CAMERA.height;
      canvas.getContext('2d').drawImage(source, 0, 0);
      if (renderer.getContext().isContextLost()) throw Error('Camera context lost');
      const copied = performance.now();
      return new Promise((resolve, reject) =>
        canvas.toBlob((blob) => {
          const done = performance.now();
          lastEncoding = {
            tick: packet.frame.tick,
            rasterMs: rasterEnd - started,
            copyMs: copied - rasterEnd,
            completionMs: done - copied,
            elapsedMs: done - started,
          };
          return blob ? resolve(blob) : reject(Error('Image encoding unavailable'));
        }, 'image/png'),
      );
    },
    read() {
      return last && { ...last, encoding: lastEncoding, resources: { ...renderer.info?.memory } };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  });
}
