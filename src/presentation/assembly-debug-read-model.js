/**
 * @typedef {{
 *   temperatureK:number,heatFlux:number,health:number,remainingMass:number,
 *   ablatedMass:number,consumed:boolean,
 * }} DebugThermalState
 * @typedef {{
 *   id:number,type:string,rigRole?:string|null,rigVisualRotation?:number[]|null,
 *   controllerBindings?:object[]|null,extensions?:Record<string,unknown>,pos:number[],
 *   scale:{x:number,y:number,z:number},
 *   mesh:import("three").Object3D, config:Record<string,number>, mechanism?:Record<string,any>, phase?:number,
 *   jointAngle?:number,reactionTorque?:number,tireDeflectionM?:number,
 *   storedEnergyWh?:number,runtimeEnergy?:number,
 *   measuredRpm?:number,powered?:boolean,flightThermal?:DebugThermalState,
 *   mechanismAuthoringDiagnostic?:{code:string,message:string,path:Array<string|number>}|null,
 *   mechanismDisplayUnit?:string,
 *   flightDetached?:boolean,flightAeroForce?:{length:()=>number},
 * }} AssemblyDebugPart
 * @typedef {{ parts:AssemblyDebugPart[],connections:object[] }} AssemblyDebugInput
 */

/** @param {AssemblyDebugInput} input */
export function buildAssemblyDebugReadModel(input) {
  return {
    parts: input.parts.map((part) => ({
      id: part.id,
      type: part.type,
      rigRole: part.rigRole || undefined,
      authored: {
        rigVisualRotation: part.rigVisualRotation
          ? structuredClone(part.rigVisualRotation)
          : undefined,
        controllerBindings: part.controllerBindings
          ? structuredClone(part.controllerBindings)
          : undefined,
        extensions: part.extensions
          ? structuredClone(part.extensions)
          : undefined,
      },
      scale: {
        x: +part.scale.x.toFixed(2),
        y: +part.scale.y.toFixed(2),
        z: +part.scale.z.toFixed(2),
      },
      position: part.pos.map((value) => +value.toFixed(2)),
      displayPosition: [
        +part.mesh.position.x.toFixed(2),
        +part.mesh.position.y.toFixed(2),
        +part.mesh.position.z.toFixed(2),
      ],
      displayYawDeg: +((part.mesh.rotation.y * 180) / Math.PI).toFixed(1),
      settings: {
        rpm: part.config?.rpm,
        teeth: part.config?.teeth,
        power: part.config?.power,
        mechanism: part.mechanism
          ? {
              componentType: part.mechanism.componentType,
              config: structuredClone(part.mechanism.config),
              authoringDiagnostic:
                structuredClone(part.mechanismAuthoringDiagnostic) || null,
              displayUnit: part.mechanismDisplayUnit || "si",
              stiffnessNPerM: part.mechanism.config?.elasticLaw?.stiffnessNPerM,
              dampingNsPerM: part.mechanism.config?.dampingLaw?.dampingNsPerM,
              freeLengthM: part.mechanism.config?.referenceLaw?.freeLengthM,
              referenceCoordinateM: part.mechanism.config?.referenceCoordinateM,
              travelRangeM: part.mechanism.config?.travelRangeM
                ? structuredClone(part.mechanism.config.travelRangeM)
                : undefined,
              radiusM: part.mechanism.config?.radiusM,
              widthM: part.mechanism.config?.widthM,
              maximumDeflectionM:
                part.mechanism.config?.tireConstitutiveLaw?.normalModel
                  ?.maximumDeflectionM,
            }
          : undefined,
      },
      phase:
        part.config?.teeth || part.type === "motor"
          ? +(part.phase || 0).toFixed(3)
          : undefined,
      jointAngle:
        part.type === "hinge" ? +(part.jointAngle || 0).toFixed(3) : undefined,
      reactionTorque:
        part.type === "hinge"
          ? +(part.reactionTorque || 0).toFixed(2)
          : undefined,
      measuredRpm:
        part.type === "sensor"
          ? +(part.measuredRpm || 0).toFixed(2)
          : undefined,
      tireDeflectionM:
        part.type === "wheel"
          ? +(part.tireDeflectionM || 0).toFixed(3)
          : undefined,
      energy:
        part.type === "battery"
          ? +(part.runtimeEnergy ?? part.storedEnergyWh ?? 0).toFixed(2)
          : undefined,
      powered: part.type === "motor" ? Boolean(part.powered) : undefined,
      aerothermal: part.flightThermal
        ? {
            temperatureC: +(part.flightThermal.temperatureK - 273.15).toFixed(
              1,
            ),
            heatFluxKWm2: +(part.flightThermal.heatFlux / 1000).toFixed(2),
            thermalHealth: +part.flightThermal.health.toFixed(3),
            remainingMassKg: +part.flightThermal.remainingMass.toFixed(3),
            ablatedMassKg: +part.flightThermal.ablatedMass.toFixed(3),
            consumed: part.flightThermal.consumed,
            detached: Boolean(part.flightDetached),
            aerodynamicForceN: +(part.flightAeroForce?.length() || 0).toFixed(
              1,
            ),
          }
        : undefined,
    })),
    connections: structuredClone(input.connections),
  };
}
