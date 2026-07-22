/**
 * @typedef {{ x:number,y:number,z:number }} DebugVector
 * @typedef {{ y:number,z:number,toeZ:number }} DebugFoot
 * @typedef {{ name:string,angle:number,target:number,torque:number }} DebugJoint
 * @typedef {{
 *   gaitPhase:string, swingSide:string, stanceSide:string,
 *   forwardDistance:number, airborneTime:number, com:DebugVector,
 *   pelvis:DebugVector, feet:{left:DebugFoot,right:DebugFoot},
 *   contacts:object, balanceError:number, fallen:boolean, joints:DebugJoint[],
 * }} HumanoidDebugTelemetry
 */

/**
 * @param {HumanoidDebugTelemetry|null|undefined} articulation
 * @returns {object|null}
 */
export function buildHumanoidDebugReadModel(articulation) {
  if (!articulation) return null;
  return {
    forwardAxis: "+Z",
    phase: articulation.gaitPhase,
    swingSide: articulation.swingSide,
    stanceSide: articulation.stanceSide,
    forwardDistance: +(articulation.forwardDistance || 0).toFixed(3),
    airborneTime: +(articulation.airborneTime || 0).toFixed(3),
    com: {
      x: +articulation.com.x.toFixed(3),
      y: +articulation.com.y.toFixed(3),
      z: +articulation.com.z.toFixed(3),
    },
    pelvis: {
      x: +articulation.pelvis.x.toFixed(3),
      y: +articulation.pelvis.y.toFixed(3),
      z: +articulation.pelvis.z.toFixed(3),
    },
    feet: {
      left: {
        y: +articulation.feet.left.y.toFixed(3),
        z: +articulation.feet.left.z.toFixed(3),
        toeZ: +articulation.feet.left.toeZ.toFixed(3),
      },
      right: {
        y: +articulation.feet.right.y.toFixed(3),
        z: +articulation.feet.right.z.toFixed(3),
        toeZ: +articulation.feet.right.toeZ.toFixed(3),
      },
    },
    contacts: structuredClone(articulation.contacts),
    balanceError: +articulation.balanceError.toFixed(3),
    fallen: articulation.fallen,
    joints: articulation.joints.map((joint) => ({
      name: joint.name,
      angle: +joint.angle.toFixed(3),
      target: +joint.target.toFixed(3),
      torque: +joint.torque.toFixed(2),
    })),
  };
}
