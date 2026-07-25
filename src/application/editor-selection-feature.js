import * as THREE from "three";

/**
 * @typedef {{
 *   id: number, type: string, mesh: THREE.Object3D,
 *   config: Record<string, number | boolean | string>, energy?: number,
 *   rigRole?: string | null, rigVisualRotation?: number[] | null,
 *   sensorValueRpm?: number,
 * }} SelectionPart
 * @typedef {{
 *   parts: () => SelectionPart[],
 *   selectedId: () => number | null,
 *   selectedIds: () => Set<number>,
 *   tool: () => string,
 *   connectFrom: () => number | null,
 *   exploded: () => boolean,
 *   explodeAmount: () => number,
 *   select: (id: number | null, ids?: Set<number>) => void,
 *   cancelConnection: () => void,
 * }} SelectionWorkspacePort
 * @typedef {{
 *   effects: THREE.Group,
 *   transform: import("three/addons/controls/TransformControls.js").TransformControls,
 *   groupPivot: THREE.Object3D,
 * }} SelectionScenePort
 * @typedef {{
 *   query: (selector: string) => HTMLElement | null,
 *   partName: (type: string) => string,
 *   positionLabel: () => void,
 * }} SelectionViewPort
 * @typedef {{
 *   connect: (fromId: number, toId: number, kind?:string, targetPort?:string|null, targetAnchorLocalM?:number[]|null) => boolean,
 *   setMode: (mode: string) => void,
 *   renderInspector: () => void,
 *   tutorialEvent: (event: string) => void,
 *   notify: (message: string) => void,
 * }} SelectionActionPort
 */

/**
 * Owns selection state transitions and their Three.js affordances. Connection
 * creation remains an injected application action, so this feature cannot
 * mutate the assembly graph by itself.
 *
 * @param {{
 *   workspace: SelectionWorkspacePort,
 *   scene: SelectionScenePort,
 *   view: SelectionViewPort,
 *   actions: SelectionActionPort,
 * }} ports
 */
export function createEditorSelectionFeature({
  workspace,
  scene,
  view,
  actions,
}) {
  let selectionBox = null;
  let selectionRing = null;
  let hoverBox = null;

  function queryRequired(selector) {
    const element = view.query(selector);
    if (!element) throw new Error(`Missing selection UI element ${selector}`);
    return element;
  }

  function clearEffect(name) {
    const object = scene.effects.getObjectByName(name);
    if (!object) return;
    scene.effects.remove(object);
    object.traverse((child) => {
      child.geometry?.dispose();
      if (Array.isArray(child.material))
        child.material.forEach((material) => material.dispose());
      else child.material?.dispose();
    });
    if (name === "selectionBox") selectionBox = null;
    if (name === "selectionRing") selectionRing = null;
    if (name === "hoverBox") hoverBox = null;
  }

  function selectedParts() {
    const ids = workspace.selectedIds();
    return workspace.parts().filter((part) => ids.has(part.id));
  }

  function update() {
    selectionBox?.update();
    scene.effects
      .getObjectByName("selectionMulti")
      ?.traverse((object) => object.update?.());
    const primary = workspace
      .parts()
      .find((part) => part.id === workspace.selectedId());
    if (selectionRing && primary)
      selectionRing.position.set(
        primary.mesh.position.x,
        0.055,
        primary.mesh.position.z,
      );
  }

  function showSelection(part) {
    clearEffect("selectionBox");
    clearEffect("selectionRing");
    clearEffect("selectionMulti");
    const label = queryRequired(".selection-label");
    if (!part) {
      label.classList.add("hidden");
      scene.transform.detach();
      return;
    }
    selectionBox = new THREE.BoxHelper(part.mesh, 0x7fffe0);
    selectionBox.name = "selectionBox";
    selectionBox.material.depthTest = false;
    selectionBox.material.transparent = true;
    selectionBox.material.opacity = 0.95;
    scene.effects.add(selectionBox);

    const selection = selectedParts();
    const multi = new THREE.Group();
    multi.name = "selectionMulti";
    for (const selected of selection) {
      if (selected.id === part.id) continue;
      const box = new THREE.BoxHelper(selected.mesh, 0xffc866);
      box.material.depthTest = false;
      box.material.transparent = true;
      box.material.opacity = 0.82;
      multi.add(box);
    }
    scene.effects.add(multi);

    const bounds = new THREE.Box3().setFromObject(part.mesh);
    const size = new THREE.Vector3();
    bounds.getSize(size);
    selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(
        Math.max(size.x, size.z) * 0.55 + 0.18,
        Math.max(size.x, size.z) * 0.55 + 0.25,
        48,
      ),
      new THREE.MeshBasicMaterial({
        color: 0x77f5d6,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    selectionRing.name = "selectionRing";
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.set(
      part.mesh.position.x,
      0.055,
      part.mesh.position.z,
    );
    scene.effects.add(selectionRing);

    const labelTitle = queryRequired(".selection-label b");
    labelTitle.textContent =
      selection.length > 1
        ? `${selection.length} COMPONENTS · PRIMARY ${view.partName(part.type).toUpperCase()} #${part.id}`
        : view.partName(part.type).toUpperCase();
    label.classList.remove("hidden");
    view.positionLabel();
    requestAnimationFrame(view.positionLabel);

    if (
      !workspace.exploded() &&
      workspace.explodeAmount() < 0.001 &&
      ["move", "rotate"].includes(workspace.tool())
    ) {
      scene.transform.setMode(
        workspace.tool() === "move" ? "translate" : "rotate",
      );
      if (selection.length > 1) {
        const center = selection
          .reduce(
            (sum, selected) => sum.add(selected.mesh.position),
            new THREE.Vector3(),
          )
          .multiplyScalar(1 / selection.length);
        scene.groupPivot.position.copy(center);
        scene.groupPivot.quaternion.identity();
        scene.transform.attach(scene.groupPivot);
      } else scene.transform.attach(part.mesh);
    } else scene.transform.detach();
  }

  function showHover(part) {
    clearEffect("hoverBox");
    if (!part || workspace.selectedIds().has(part.id)) return;
    hoverBox = new THREE.BoxHelper(
      part.mesh,
      workspace.connectFrom() ? 0xffc25c : 0xb7fff0,
    );
    hoverBox.name = "hoverBox";
    hoverBox.material.transparent = true;
    hoverBox.material.opacity = 0.65;
    hoverBox.material.depthTest = false;
    scene.effects.add(hoverBox);
  }

  function select(id, additive = false, { targetAnchorLocalM = null } = {}) {
    const connectFrom = workspace.connectFrom();
    if (connectFrom) additive = false;
    if (additive) {
      const ids = new Set(workspace.selectedIds());
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      workspace.select(
        ids.has(id) ? id : ids.values().next().value || null,
        ids,
      );
    } else workspace.select(id);
    showSelection(
      workspace.parts().find((part) => part.id === workspace.selectedId()) ||
        null,
    );
    if (connectFrom && id !== connectFrom) {
      const connected = actions.connect(
        connectFrom,
        id,
        "auto",
        null,
        targetAnchorLocalM,
      );
      workspace.cancelConnection();
      view.query(".connection-banner")?.classList.add("hidden");
      clearEffect("previewLine");
      actions.setMode("build");
      if (connected) {
        actions.notify("Physical connection created");
        actions.tutorialEvent("connected");
      }
    }
    actions.renderInspector();
  }

  return Object.freeze({
    clearEffect,
    select,
    selectedParts,
    showHover,
    showSelection,
    update,
    updateHover() {
      hoverBox?.update();
    },
  });
}
