const sharedResources = new WeakSet();
const sharedGeometryCache = new Map();
const sharedMaterials = new Set();
const sharedTextures = new Set();
const activeOwnedResources = new Map();

const CACHEABLE_GEOMETRIES = new Set([
  "BoxGeometry",
  "BufferGeometry",
  "ConeGeometry",
  "CylinderGeometry",
  "ExtrudeGeometry",
  "LatheGeometry",
  "PlaneGeometry",
  "RingGeometry",
  "RoundedBoxGeometry",
  "SphereGeometry",
  "TorusGeometry",
  "TubeGeometry",
]);

/** Marks an immutable render resource whose lifetime is the application. */
export function markSharedRenderResource(resource) {
  if (resource && typeof resource === "object") {
    sharedResources.add(resource);
    if (resource.isMaterial) sharedMaterials.add(resource);
    if (resource.isTexture) sharedTextures.add(resource);
  }
  return resource;
}

/** Tracks a disposable, object-owned resource without retaining it after release. */
export function trackOwnedRenderResource(resource, category) {
  if (!resource || typeof resource.addEventListener !== "function")
    return resource;
  const key = String(category || "other");
  activeOwnedResources.set(key, (activeOwnedResources.get(key) || 0) + 1);
  let active = true;
  const released = () => {
    if (!active) return;
    active = false;
    activeOwnedResources.set(
      key,
      Math.max(0, (activeOwnedResources.get(key) || 0) - 1),
    );
    resource.removeEventListener("dispose", released);
  };
  resource.addEventListener("dispose", released);
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
  const explicitKey = geometry.userData.sharedPrimitiveKey;
  if (!explicitKey && !geometry.parameters) return geometry;
  const tier = geometry.userData.sharedDetailTier || "unscoped",
    key = explicitKey
      ? `${tier}:${geometry.type}:${explicitKey}`
      : `${tier}:${geometry.type}:${JSON.stringify(geometry.parameters)}`;
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
  const geometries = [...sharedGeometryCache.values()],
    activeTierResources = {};
  for (const geometry of geometries) {
    const tier = geometry.userData.sharedDetailTier || "unscoped";
    activeTierResources[tier] = (activeTierResources[tier] || 0) + 1;
  }
  return {
    primitiveGeometries: geometries.filter(
      (geometry) => geometry.userData.sharedGeometryCategory !== "profile",
    ).length,
    profileGeometries: geometries.filter(
      (geometry) => geometry.userData.sharedGeometryCategory === "profile",
    ).length,
    baseMaterials: sharedMaterials.size,
    sharedTextures: sharedTextures.size,
    activeTierResources: Object.fromEntries(
      Object.entries(activeTierResources).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    owned: Object.fromEntries(
      [...activeOwnedResources].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}
