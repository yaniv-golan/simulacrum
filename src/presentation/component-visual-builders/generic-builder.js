import * as THREE from "three";
import { bolt, mesh } from "../mesh-primitives.js";

export function buildGenericGeometry({ g, accent, visualDescriptor }) {
  const { size } = visualDescriptor;
  mesh(new THREE.BoxGeometry(...size), accent, [0, 0, 0], [], g);
  for (const x of [-1, 1])
    for (const z of [-1, 1])
      bolt(g, x * size[0] * 0.37, size[1] * 0.52, z * size[2] * 0.35);
}
