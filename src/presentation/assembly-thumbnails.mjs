import * as THREE from 'three';

const WIDTH = 320;
const HEIGHT = 200;
const CACHE_LIMIT = 24;

/** Render saved authored geometry without retaining a second live machine. */
export function createAssemblyThumbnails({ createMesh, disposeMesh }) {
  const cache = new Map();
  let renderer;
  let disposed = false;

  function render(definition) {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(1);
      renderer.setSize(WIDTH, HEIGHT, false);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    scene.add(group);
    scene.add(new THREE.HemisphereLight(0xe5f5ff, 0x475565, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(2, 4, 3);
    scene.add(light);
    try {
      for (const part of definition.parts) {
        const mesh = createMesh(part);
        group.add(mesh);
        mesh.position.fromArray(part.position);
        mesh.quaternion.fromArray(part.rotation);
      }
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
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer = undefined;
    },
  };
}
