import * as THREE from 'three';
import type { ConnectionRenderSpec } from '../../src/presentation/connection-render.js';
const valid: ConnectionRenderSpec = {
  id: 'edge',
  kind: 'power',
  ends: [new THREE.Vector3(), new THREE.Vector3()],
  visible: true,
  highlighted: false,
  exploded: false,
  failed: false,
};
const { visible, ...missing } = valid;
const bad: ConnectionRenderSpec = missing;
