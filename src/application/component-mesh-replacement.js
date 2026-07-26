import { disposeObject3D } from "../presentation/render-resources.js";

/** Atomically replaces canonical geometry while preserving scene identity. */
export function replaceComponentMesh({ part, createMesh, fallbackParent }) {
  const previous = part.mesh,
    parent = previous.parent || fallbackParent,
    siblingIndex = parent.children.indexOf(previous),
    replacement = createMesh(part, part.customColor);
  replacement.position.set(...part.pos);
  replacement.quaternion.set(...part.orientation);
  replacement.scale.set(1, 1, 1);
  replacement.visible = previous.visible;
  replacement.layers.mask = previous.layers.mask;
  replacement.renderOrder = previous.renderOrder;
  replacement.name = previous.name;
  replacement.userData.partId = part.id;
  replacement.traverse((object) => (object.userData.partId = part.id));
  parent.remove(previous);
  parent.add(replacement);
  if (siblingIndex >= 0) {
    parent.children.splice(parent.children.indexOf(replacement), 1);
    parent.children.splice(siblingIndex, 0, replacement);
  }
  part.mesh = replacement;
  disposeObject3D(previous);
  return replacement;
}
