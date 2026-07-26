/** Presentation-only emphasis for owner-produced connection witnesses. */
export function createRelationshipTraceController({ wires }) {
  let activeConnectionIds = Object.freeze([]);

  function clear() {
    for (const wire of wires.children) {
      const material = wire.material;
      if (!material || Array.isArray(material)) continue;
      if (material.userData.routeOriginalOpacity != null) {
        material.opacity = material.userData.routeOriginalOpacity;
        delete material.userData.routeOriginalOpacity;
      }
      if (material.userData.routeOriginalColor != null) {
        material.color.setHex(material.userData.routeOriginalColor);
        delete material.userData.routeOriginalColor;
      }
    }
    activeConnectionIds = Object.freeze([]);
  }

  function show(connectionIds = []) {
    clear();
    const selected = new Set(connectionIds);
    activeConnectionIds = Object.freeze([...selected]);
    for (const wire of wires.children) {
      const material = wire.material;
      if (!material || Array.isArray(material)) continue;
      material.userData.routeOriginalOpacity = material.opacity;
      material.userData.routeOriginalColor = material.color.getHex();
      if (selected.has(wire.userData.connectionId)) {
        material.opacity = 1;
        material.color.setHex(0xffffff);
      } else material.opacity = Math.max(0.28, material.opacity * 0.45);
    }
  }

  function showSegments({ input = [], output = [] } = {}) {
    clear();
    const inputIds = new Set(input),
      outputIds = new Set(output);
    activeConnectionIds = Object.freeze([
      ...new Set([...inputIds, ...outputIds]),
    ]);
    for (const wire of wires.children) {
      const material = wire.material;
      if (!material || Array.isArray(material)) continue;
      material.userData.routeOriginalOpacity = material.opacity;
      material.userData.routeOriginalColor = material.color.getHex();
      if (inputIds.has(wire.userData.connectionId)) {
        material.opacity = 1;
        material.color.setHex(0x70e0c4);
      } else if (outputIds.has(wire.userData.connectionId)) {
        material.opacity = 1;
        material.color.setHex(0xffc866);
      } else material.opacity = Math.max(0.28, material.opacity * 0.45);
    }
  }

  return Object.freeze({
    clear,
    show,
    showSegments,
    activeConnectionIds: () => activeConnectionIds,
    dispose: clear,
  });
}
