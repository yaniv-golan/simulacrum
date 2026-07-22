import * as THREE from "three";

/**
 * @typedef {{ id:number, type:string, mesh:THREE.Object3D }} DesignPart
 * @typedef {{ kind:string, a:number, b:number }} DesignConnection
 * @typedef {{ noseAligned:boolean, alignedFins:number, centerlineError:number, stability:number }} MissionDesignState
 */

/**
 * Derives aerodynamic design quality only from authored geometry and validated
 * connections. It is deliberately demo-agnostic and contains no runtime state.
 *
 * @param {{
 *   parts:DesignPart[], connections:DesignConnection[],
 *   connectionValid:(connection:DesignConnection)=>boolean,
 * }} input
 * @returns {MissionDesignState}
 */
export function analyzeMissionDesign({ parts, connections, connectionValid }) {
  const nose = parts.find((part) => part.type === "nosecone"),
    noseLink = nose
      ? connections.find(
          (connection) =>
            connection.kind === "mechanical" &&
            (connection.a === nose.id || connection.b === nose.id),
        )
      : null,
    noseAligned = Boolean(
      nose &&
      noseLink &&
      connectionValid(noseLink) &&
      Math.hypot(nose.mesh.position.x, nose.mesh.position.z) < 0.16 &&
      new THREE.Vector3(0, 1, 0)
        .applyQuaternion(nose.mesh.quaternion)
        .dot(new THREE.Vector3(0, 1, 0)) > 0.985,
    ),
    fins = parts.filter((part) => part.type === "fin"),
    alignedFins = fins.filter(
      (fin) =>
        connections.some(
          (connection) =>
            connection.kind === "mechanical" &&
            (connection.a === fin.id || connection.b === fin.id) &&
            connectionValid(connection),
        ) &&
        fin.mesh.position.y < 2.4 &&
        Math.hypot(fin.mesh.position.x, fin.mesh.position.z) > 0.32 &&
        Math.abs(
          new THREE.Vector3(0, 1, 0)
            .applyQuaternion(fin.mesh.quaternion)
            .dot(new THREE.Vector3(0, 1, 0)),
        ) > 0.985,
    ).length,
    coreParts = parts.filter((part) =>
      ["rocket", "beam", "battery", "computer", "nosecone"].includes(part.type),
    ),
    centerlineError = coreParts.length
      ? Math.sqrt(
          coreParts.reduce(
            (sum, part) =>
              sum + part.mesh.position.x ** 2 + part.mesh.position.z ** 2,
            0,
          ) / coreParts.length,
        )
      : 0;
  return Object.freeze({
    noseAligned,
    alignedFins,
    centerlineError,
    stability: THREE.MathUtils.clamp(
      (alignedFins / 4) * (noseAligned ? 1 : 0.72) - centerlineError * 0.35,
      0,
      1,
    ),
  });
}
