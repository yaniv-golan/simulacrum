import * as THREE from 'three';
import { CATALOG } from '../model/catalog.mjs';
import { resolveSurfaceEndpoint } from '../model/surfaces.mjs';
import { createConnectionView } from './connection-view.mjs';
import { connectionRenderSpecs } from './connection-render.mjs';
import { createSpringView } from './spring-view.mjs';
import { createFinishEnvironment } from './part-finish.mjs';

const WIDTH = 320;
const HEIGHT = 200;
const CACHE_LIMIT = 24;

/** Compose the same connection visuals as Build, from saved authored transforms. */
export function createAssemblyConnections(group, definition) {
  const parts = new Map(definition.parts.map((part) => [part.id, part]));
  const resolveEndpoint = (endpoint) => {
    const part = parts.get(endpoint.part);
    if (!part) return null;
    const port = endpoint.surface
      ? resolveSurfaceEndpoint(part, endpoint)
      : CATALOG[part.type]?.ports.find((port) => port.id === endpoint.port);
    return port
      ? new THREE.Vector3(...port.position)
          .applyQuaternion(new THREE.Quaternion(...part.rotation))
          .add(new THREE.Vector3(...part.position))
      : null;
  };
  const connections = definition.connections ?? [];
  const wires = createConnectionView(group);
  const springs = createSpringView(group);
  wires.update(
    connectionRenderSpecs({
      connections,
      resolveEndpoint,
      wiringVisible: true,
      exploded: false,
      diagnostics: connections.map((edge) => ({ id: edge.id, reasonCode: 'OK' })),
      revealedConnectionIds: new Set(),
      testConnectionIds: new Set(),
    }),
  );
  springs.update(
    connections
      .filter((edge) => edge.kind === 'spring')
      .flatMap((edge) => {
        const a = resolveEndpoint(edge.a),
          b = resolveEndpoint(edge.b);
        if (!a || !b) return [];
        const aType = parts.get(edge.a.part).type,
          bType = parts.get(edge.b.part).type;
        const forward = ['springGuide', 'linearActuator'].includes(aType);
        return [
          {
            id: edge.id,
            linear: aType === 'linearActuator' || bType === 'linearActuator',
            a: forward ? a : b,
            b: forward ? b : a,
          },
        ];
      }),
  );
  return {
    readRenderedSpringEndpoints: springs.readRenderedEndpoints,
    dispose() {
      wires.dispose();
      springs.dispose();
    },
  };
}

/** Render saved authored geometry without retaining a second live machine. */
export function createAssemblyThumbnails({ createMesh, disposeMesh }) {
  const cache = new Map();
  let renderer;
  let finishEnvironment;
  let disposed = false;

  function render(definition) {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(1);
      renderer.setSize(WIDTH, HEIGHT, false);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      finishEnvironment = createFinishEnvironment(renderer);
    }
    const scene = new THREE.Scene();
    scene.environment = finishEnvironment.texture;
    scene.environmentIntensity = 0.4;
    const group = new THREE.Group();
    scene.add(group);
    scene.add(new THREE.HemisphereLight(0xe5f5ff, 0x475565, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(2, 4, 3);
    scene.add(light);
    let connections;
    try {
      for (const part of definition.parts) {
        const mesh = createMesh(part);
        group.add(mesh);
        mesh.position.fromArray(part.position);
        mesh.quaternion.fromArray(part.rotation);
      }
      connections = createAssemblyConnections(group, definition);
      group.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(group);
      if (bounds.isEmpty()) throw new Error('This assembly has no preview geometry.');
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 0.0001) * 1.15;
      const aspect = WIDTH / HEIGHT;
      const camera = new THREE.OrthographicCamera(
        -radius * aspect,
        radius * aspect,
        radius,
        -radius,
        radius * 0.01,
        radius * 10,
      );
      camera.position
        .copy(sphere.center)
        .addScaledVector(new THREE.Vector3(1, 0.8, 1).normalize(), radius * 3);
      camera.lookAt(sphere.center);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    } finally {
      connections?.dispose();
      for (const mesh of [...group.children]) {
        group.remove(mesh);
        disposeMesh(mesh);
      }
      renderer.renderLists.dispose();
    }
  }

  return {
    image(definition) {
      if (disposed) throw new Error('Assembly previews are closed.');
      const key = JSON.stringify(definition);
      let source = cache.get(key);
      if (source) cache.delete(key);
      else source = render(definition);
      cache.set(key, source);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      const image = document.createElement('img');
      image.src = source;
      image.alt = `Rendered preview of ${definition.name}, ${definition.parts.length} parts`;
      image.width = WIDTH;
      image.height = HEIGHT;
      image.draggable = false;
      return image;
    },
    dispose() {
      disposed = true;
      cache.clear();
      finishEnvironment?.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer = undefined;
    },
  };
}
