/**
 * @typedef {{
 *   signedSpeed:number, grounded:boolean, inWater:boolean, bottomContact:boolean,
 *   onField:boolean, edgeDistance:number, brake:boolean, submergedFraction:number,
 *   buoyancyN:number, weightN:number, wheelContacts:number, waterDepth:number,
 *   lights:boolean, motorPartIds?:number[],
 *   supportMaterialKeys?:string[], supportMaterialLaws?:Array<{materialKey:string,longitudinalFrictionCoefficient:number,rollingResistanceMultiplier?:number,maximumSinkageM?:number}>,
 *   pose:{position:{y:number}}, velocity:{y:number},
 *   driveForce:{availableMotorPowerW?:number},
 * }} MobilityMissionTelemetry
 */

/** Derives user-facing mobility status from one completed telemetry record. */
export function mobilityMissionReadModel(telemetry) {
  if (!telemetry.motorPartIds?.length)
    return Object.freeze({
      name: "DRIVETRAIN INCOMPLETE",
      description:
        "Connect a motor shaft to a wheel axle through rotating mechanical ports.",
      progressPercent: 0,
    });
  if ((telemetry.driveForce.availableMotorPowerW || 0) <= 0)
    return Object.freeze({
      name: "DRIVETRAIN UNPOWERED",
      description:
        "The wheel-drive motor needs a live electrical path to a charged power source.",
      progressPercent: 0,
    });

  const supportLaw = telemetry.supportMaterialLaws?.[0],
    supportLabel = supportLaw?.materialKey
      ?.split("-")
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(" "),
    supportDescription = supportLaw
      ? `${supportLabel} μlong ${supportLaw.longitudinalFrictionCoefficient.toFixed(2)} · rolling ×${supportLaw.rollingResistanceMultiplier.toFixed(1)}${supportLaw.maximumSinkageM ? ` · soft ${Math.round(supportLaw.maximumSinkageM * 100)} cm max` : ""}`
      : "No tire support contact",
    falling = !telemetry.grounded && !telemetry.inWater,
    name = falling
      ? "ROVER FALLING"
      : telemetry.bottomContact && telemetry.inWater
        ? "POND BOTTOM"
        : telemetry.inWater
          ? "ROVER SUBMERGED"
          : telemetry.onField
            ? "FIELD TERRAIN"
            : telemetry.edgeDistance < 3
              ? "PLATFORM EDGE"
              : telemetry.brake
                ? "ROVER BRAKING"
                : telemetry.signedSpeed < -0.1
                  ? "ROVER REVERSING"
                  : Math.abs(telemetry.signedSpeed) > 0.1
                    ? "ROVER IN MOTION"
                    : "DRIVER READY",
    description = falling
      ? `Altitude ${telemetry.pose.position.y.toFixed(1)} m · vertical speed ${telemetry.velocity.y.toFixed(1)} m/s`
      : telemetry.inWater
        ? `${Math.round(telemetry.submergedFraction * 100)}% displaced volume submerged · buoyancy ${(telemetry.buoyancyN / 1000).toFixed(2)} kN / weight ${(telemetry.weightN / 1000).toFixed(2)} kN · ${telemetry.bottomContact ? `${telemetry.wheelContacts} tire contacts` : `water depth ${telemetry.waterDepth.toFixed(1)} m`}`
        : telemetry.onField
          ? `${supportDescription} · ${telemetry.signedSpeed < -0.1 ? "reverse" : "forward"} ${Math.abs(telemetry.signedSpeed).toFixed(1)} m/s · lights ${telemetry.lights ? "ON" : "OFF"}`
          : `${telemetry.signedSpeed < -0.1 ? "Reverse" : "Forward"} ${Math.abs(telemetry.signedSpeed).toFixed(1)} m/s · edge ${Math.max(0, telemetry.edgeDistance).toFixed(1)} m · lights ${telemetry.lights ? "ON" : "OFF"}`;
  return Object.freeze({ name, description, progressPercent: null });
}
