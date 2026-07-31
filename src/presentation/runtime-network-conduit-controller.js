import * as THREE from "three";
import { geometryDescriptorForPart } from "../model/geometry-descriptors.js";

const SEGMENTS_PER_CONDUIT = 8;
const UP = new THREE.Vector3(0, 1, 0);
const VISUALS = Object.freeze({
  power: Object.freeze({ color: 0xff8b48, radiusM: 0.026 }),
  resource: Object.freeze({ color: 0xb787ff, radiusM: 0.034 }),
  signal: Object.freeze({ color: 0x67b9ff, radiusM: 0.018 }),
});

/** @typedef {{id:string|number,kind:string,portA:string,portB:string,startWorldM:number[],endWorldM:number[],sagM:number}} ConduitSnapshot */
/** @typedef {{visible:boolean,connectionCount:number,segmentCount:number,byKind:Readonly<Record<string,number>>,connections:ReadonlyArray<ConduitSnapshot>}} ConduitVisualSnapshot */

export const RUNTIME_NETWORK_CONDUIT_KINDS = Object.freeze(
  Object.keys(VISUALS),
);

export function isRuntimeNetworkConduit(connection) {
  return (
    RUNTIME_NETWORK_CONDUIT_KINDS.includes(connection?.kind) &&
    !connection.failed
  );
}

function roundedVector(vector) {
  return [vector.x, vector.y, vector.z].map((value) =>
    Number(value.toFixed(4)),
  );
}

/**
 * Projects live network topology as bounded physical conduits. The simulation
 * still owns transport and connectivity; this controller only mirrors exact
 * endpoint port frames and updates their presentation pose.
 */
export function createRuntimeNetworkConduitController({
  parent,
  parts,
  connections,
  connectionValid,
}) {
  const group = new THREE.Group(),
    unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false),
    materials = Object.fromEntries(
      Object.entries(VISUALS).map(([kind, visual]) => [
        kind,
        new THREE.MeshStandardMaterial({
          color: visual.color,
          roughness: 0.58,
          metalness: 0.08,
        }),
      ]),
    ),
    parentInverse = new THREE.Matrix4(),
    startWorld = new THREE.Vector3(),
    endWorld = new THREE.Vector3(),
    controlWorld = new THREE.Vector3(),
    priorWorld = new THREE.Vector3(),
    nextWorld = new THREE.Vector3(),
    priorLocal = new THREE.Vector3(),
    nextLocal = new THREE.Vector3(),
    midpoint = new THREE.Vector3(),
    direction = new THREE.Vector3(),
    quaternion = new THREE.Quaternion(),
    scale = new THREE.Vector3(),
    matrix = new THREE.Matrix4();
  group.name = "runtimeNetworkConduits";
  parent.add(group);

  let entries = [],
    meshes = new Map();

  function removeMeshes() {
    for (const mesh of meshes.values()) {
      group.remove(mesh);
      mesh.dispose();
    }
    meshes = new Map();
  }

  function endpointWorld(part, positionPartM, target) {
    target.set(...positionPartM);
    part.mesh.localToWorld(target);
    return target;
  }

  function pointOnCurve(start, control, end, t, target) {
    const oneMinusT = 1 - t;
    return target
      .copy(start)
      .multiplyScalar(oneMinusT * oneMinusT)
      .addScaledVector(control, 2 * oneMinusT * t)
      .addScaledVector(end, t * t);
  }

  function update() {
    if (!entries.length) return;
    parent.updateWorldMatrix(true, false);
    parentInverse.copy(parent.matrixWorld).invert();

    for (const entry of entries) {
      endpointWorld(entry.left, entry.startPartM, startWorld);
      endpointWorld(entry.right, entry.endPartM, endWorld);
      const distanceM = startWorld.distanceTo(endWorld),
        sagM = Math.min(0.38, Math.max(0.06, distanceM * 0.12));
      controlWorld.copy(startWorld).add(endWorld).multiplyScalar(0.5);
      controlWorld.y -= sagM;
      pointOnCurve(startWorld, controlWorld, endWorld, 0, priorWorld);
      for (let segment = 0; segment < SEGMENTS_PER_CONDUIT; segment += 1) {
        pointOnCurve(
          startWorld,
          controlWorld,
          endWorld,
          (segment + 1) / SEGMENTS_PER_CONDUIT,
          nextWorld,
        );
        priorLocal.copy(priorWorld).applyMatrix4(parentInverse);
        nextLocal.copy(nextWorld).applyMatrix4(parentInverse);
        midpoint.copy(priorLocal).add(nextLocal).multiplyScalar(0.5);
        direction.copy(nextLocal).sub(priorLocal);
        const lengthM = Math.max(0.0001, direction.length()),
          radiusM = VISUALS[entry.connection.kind].radiusM,
          mesh = meshes.get(entry.connection.kind),
          instance = entry.instanceStart + segment;
        quaternion.setFromUnitVectors(UP, direction.normalize());
        scale.set(radiusM, lengthM, radiusM);
        matrix.compose(midpoint, quaternion, scale);
        mesh.setMatrixAt(instance, matrix);
        priorWorld.copy(nextWorld);
      }
      entry.startWorldM[0] = startWorld.x;
      entry.startWorldM[1] = startWorld.y;
      entry.startWorldM[2] = startWorld.z;
      entry.endWorldM[0] = endWorld.x;
      entry.endWorldM[1] = endWorld.y;
      entry.endWorldM[2] = endWorld.z;
      entry.sagM = sagM;
    }
    for (const mesh of meshes.values()) mesh.instanceMatrix.needsUpdate = true;
  }

  function sync() {
    removeMeshes();
    const byId = new Map(parts().map((part) => [part.id, part]));
    entries = connections()
      .filter(
        (connection) =>
          isRuntimeNetworkConduit(connection) && connectionValid(connection),
      )
      .map((connection) => ({
        connection,
        left: byId.get(connection.a),
        right: byId.get(connection.b),
      }))
      .map(({ connection, left, right }) => ({
        connection,
        left,
        right,
        startPartM: left
          ? geometryDescriptorForPart(left).portFrames[connection.portA]
              ?.framePart.positionM
          : null,
        endPartM: right
          ? geometryDescriptorForPart(right).portFrames[connection.portB]
              ?.framePart.positionM
          : null,
        startWorldM: [0, 0, 0],
        endWorldM: [0, 0, 0],
        sagM: 0,
        instanceStart: 0,
      }))
      .filter(({ left, right, startPartM, endPartM }) =>
        Boolean(left && right && startPartM && endPartM),
      );
    const nextInstanceByKind = Object.fromEntries(
      RUNTIME_NETWORK_CONDUIT_KINDS.map((kind) => [kind, 0]),
    );
    for (const entry of entries) {
      entry.instanceStart = nextInstanceByKind[entry.connection.kind];
      nextInstanceByKind[entry.connection.kind] += SEGMENTS_PER_CONDUIT;
    }
    for (const kind of RUNTIME_NETWORK_CONDUIT_KINDS) {
      const count = entries.filter(
        ({ connection }) => connection.kind === kind,
      ).length;
      if (!count) continue;
      const mesh = new THREE.InstancedMesh(
        unitCylinder,
        materials[kind],
        count * SEGMENTS_PER_CONDUIT,
      );
      mesh.name = `runtime-${kind}-conduits`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      meshes.set(kind, mesh);
      group.add(mesh);
    }
    group.visible = entries.length > 0;
    if (entries.length) update();
  }

  function clear() {
    entries = [];
    removeMeshes();
    group.visible = false;
  }

  /** @returns {ConduitVisualSnapshot} */
  function snapshot() {
    const byKind = Object.fromEntries(
        RUNTIME_NETWORK_CONDUIT_KINDS.map((kind) => [
          kind,
          entries.filter(({ connection }) => connection.kind === kind).length,
        ]).filter(([, count]) => Number(count) > 0),
      ),
      connectionSnapshots = entries.map((entry) => ({
        id: entry.connection.id,
        kind: entry.connection.kind,
        portA: entry.connection.portA,
        portB: entry.connection.portB,
        startWorldM: roundedVector({
          x: entry.startWorldM[0],
          y: entry.startWorldM[1],
          z: entry.startWorldM[2],
        }),
        endWorldM: roundedVector({
          x: entry.endWorldM[0],
          y: entry.endWorldM[1],
          z: entry.endWorldM[2],
        }),
        sagM: Number(entry.sagM.toFixed(4)),
      }));
    return Object.freeze({
      visible: parent.visible && group.visible,
      connectionCount: connectionSnapshots.length,
      segmentCount: connectionSnapshots.length * SEGMENTS_PER_CONDUIT,
      byKind: Object.freeze(byKind),
      connections: Object.freeze(connectionSnapshots),
    });
  }

  return Object.freeze({
    clear,
    snapshot,
    sync,
    update,
  });
}
