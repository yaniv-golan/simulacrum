const sharedResources = new WeakSet();
const sharedGeometryCache = new Map();

const CACHEABLE_GEOMETRIES = new Set([
  "BoxGeometry",
  "ConeGeometry",
  "CylinderGeometry",
  "PlaneGeometry",
  "RingGeometry",
  "SphereGeometry",
  "TorusGeometry",
]);

/** Marks an immutable render resource whose lifetime is the application. */
export function markSharedRenderResource(resource) {
  if (resource && typeof resource === "object") sharedResources.add(resource);
  return resource;
}

export function isSharedRenderResource(resource) {
  return Boolean(resource && sharedResources.has(resource));
}

/**
 * Reuses immutable primitive geometry across component meshes. Complex path and
 * extrusion geometry stays owned by its component because its parameters are
 * not safely canonicalizable.
 */
export function sharePrimitiveGeometry(geometry) {
  if (!geometry || !CACHEABLE_GEOMETRIES.has(geometry.type)) return geometry;
  const key = `${geometry.type}:${JSON.stringify(geometry.parameters)}`;
  const existing = sharedGeometryCache.get(key);
  if (existing) {
    geometry.dispose();
    return existing;
  }
  sharedGeometryCache.set(key, geometry);
  return markSharedRenderResource(geometry);
}

function materialsOf(material) {
  return Array.isArray(material) ? material : material ? [material] : [];
}

function disposeOwnedMaterial(material, disposed) {
  if (!material || disposed.has(material) || isSharedRenderResource(material))
    return;
  disposed.add(material);
  for (const value of Object.values(material))
    if (
      value?.isTexture &&
      !disposed.has(value) &&
      !isSharedRenderResource(value)
    ) {
      disposed.add(value);
      value.dispose();
    }
  material.dispose();
}

/** Releases resources owned by a hierarchy while retaining shared catalog data. */
export function disposeObject3D(object, { remove = true } = {}) {
  if (!object) return;
  if (remove) object.removeFromParent();
  const disposed = new Set();
  object.traverse((child) => {
    if (child.isLight) child.shadow?.dispose();
    // InstancedMesh owns GPU attributes outside its BufferGeometry. Three.js
    // releases those attributes only when the mesh itself emits `dispose`.
    // Disposing geometry/material alone leaks one instance buffer per rebuild.
    if (child.isInstancedMesh) child.dispose();
    const geometry = child.geometry;
    if (
      geometry &&
      !disposed.has(geometry) &&
      !isSharedRenderResource(geometry)
    ) {
      disposed.add(geometry);
      geometry.dispose();
    }
    for (const material of materialsOf(child.material))
      disposeOwnedMaterial(material, disposed);
  });
}

export function sharedRenderResourceStats() {
  return { primitiveGeometries: sharedGeometryCache.size };
}
