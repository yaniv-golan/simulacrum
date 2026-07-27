import { completedMultibodyFailureEvidence } from "../multibody-runtime.js";

function horizontalProgress(left, right) {
  return Math.hypot(
    Number(right?.x || 0) - Number(left?.x || 0),
    Number(right?.z || 0) - Number(left?.z || 0),
  );
}

function finiteVector(vector) {
  return [vector?.x, vector?.y, vector?.z].every((value) =>
    Number.isFinite(Number(value ?? 0)),
  );
}

function finiteContribution(row) {
  return (
    Number.isFinite(Number(row?.multiplier ?? 0)) &&
    Number.isFinite(Number(row?.forceMagnitudeN ?? 0)) &&
    Number.isFinite(Number(row?.momentMagnitudeNm ?? 0)) &&
    finiteVector(row?.forceWorldN) &&
    finiteVector(row?.momentAtApplicationPointWorldNm) &&
    finiteVector(row?.applicationPointWorldM)
  );
}

function compactMobilityTelemetry(mobility) {
  return {
    assemblies: (mobility?.assemblies || []).map((assembly) => ({
      assemblyId: assembly.assemblyId,
      pose: { position: structuredClone(assembly.pose?.position) },
      signedSpeed: assembly.signedSpeed,
      grounded: assembly.grounded,
      brake: assembly.brake,
      driveForce: {
        motors: structuredClone(
          (assembly.driveForce?.motors || []).filter(
            (motor) => motor.partId != null,
          ),
        ),
      },
      wheelStates: (assembly.wheelStates || [])
        .filter((wheel) => wheel.partId != null)
        .map((wheel) => ({
          partId: wheel.partId,
          touching: wheel.touching,
          angularSpeed: wheel.angularSpeed,
          normalLoadN: wheel.normalLoadN,
        })),
    })),
  };
}

function finiteMobility(assembly) {
  const values = [
    assembly?.signedSpeed,
    assembly?.pose?.position?.x,
    assembly?.pose?.position?.y,
    assembly?.pose?.position?.z,
    assembly?.driveForce?.deliveredMotorPowerW,
    ...(assembly?.wheelStates || []).flatMap((wheel) => [
      wheel.angularSpeed,
      wheel.normalLoadN,
      wheel.longitudinalForceN,
      wheel.lateralForceN,
    ]),
  ];
  return values.every((value) => Number.isFinite(Number(value ?? 0)));
}

/** Finalizes observer-only failure evidence after canonical mobility telemetry. */
export class FailureEvidenceSystem {
  phase = "telemetry";

  initialize(context) {
    this.positionsByAssembly = new Map();
    this.lastGraphRevision = Number(context?.runGraph?.graphRevision || 0);
  }

  step(context) {
    const recorder = context.services.failureEvidenceRecorder;
    if (!recorder) return;
    if (!recorder.acceptingEvidence()) {
      context.telemetry.failureEvidence = recorder.telemetrySummary();
      return;
    }
    const policy = recorder.policy,
      assemblies = context.telemetry.mobility?.assemblies || [],
      liveAssemblyIds = new Set();
    for (const assembly of assemblies) {
      const assemblyId = String(assembly.assemblyId);
      liveAssemblyIds.add(assemblyId);
      if (!finiteMobility(assembly))
        recorder.trigger({
          kind: "numerical-anomaly",
          tick: context.clock.tick,
          timeS: context.time,
          subjectId: assemblyId,
          validity: "measured",
        });
      const motors = assembly.driveForce?.motors || [],
        commanded = motors.some(
          (motor) =>
            Math.abs(Number(motor.resolvedThrottle || 0)) >=
            policy.stallCommandAbsMin,
        ),
        availablePowerW = Number(
          assembly.driveForce?.availableMotorPowerW || 0,
        ),
        deliveredPowerW = Number(
          assembly.driveForce?.deliveredMotorPowerW || 0,
        ),
        powered =
          deliveredPowerW >= policy.stallPowerFloorW &&
          deliveredPowerW >= availablePowerW * policy.stallPowerFractionMin,
        touching = (assembly.wheelStates || []).some((wheel) => wheel.touching),
        candidate =
          commanded &&
          powered &&
          assembly.grounded &&
          touching &&
          Number(assembly.brake || 0) <= 0.05,
        positions = this.positionsByAssembly.get(assemblyId) || [];
      if (candidate) {
        positions.push({
          tick: context.clock.tick,
          position: structuredClone(assembly.pose.position),
        });
        if (positions.length > policy.stallDwellTicks)
          positions.splice(0, positions.length - policy.stallDwellTicks);
        this.positionsByAssembly.set(assemblyId, positions);
        if (
          positions.length === policy.stallDwellTicks &&
          horizontalProgress(
            positions[0].position,
            positions.at(-1).position,
          ) <= policy.stallMaxProgressM
        )
          recorder.trigger({
            kind: "rolling-actuator-stall",
            tick: context.clock.tick,
            timeS: context.time,
            subjectId: assemblyId,
            validity: "measured",
          });
      } else this.positionsByAssembly.delete(assemblyId);
    }
    for (const assemblyId of this.positionsByAssembly.keys())
      if (!liveAssemblyIds.has(assemblyId))
        this.positionsByAssembly.delete(assemblyId);

    const bodySnapshot = context.bodyRegistry.snapshot();
    for (const body of bodySnapshot.bodies)
      for (const contact of body.contacts)
        if (contact.tireEvidence?.withinGeometricTolerance === false)
          recorder.trigger({
            kind: "contact-invariant",
            tick: context.clock.tick,
            timeS: context.time,
            subjectId: contact.tireEvidence.tirePartId,
            validity: contact.tireEvidence.validity,
          });

    const invalidContribution = completedMultibodyFailureEvidence(
      context.services.multibodyRuntime,
    ).find((row) => !finiteContribution(row));
    if (invalidContribution)
      recorder.trigger({
        kind: "numerical-anomaly",
        tick: context.clock.tick,
        timeS: context.time,
        subjectId: invalidContribution.rowId,
        validity: "measured",
      });

    const graphRevision = Number(context.runGraph.graphRevision || 0);
    if (graphRevision !== this.lastGraphRevision) {
      const explained = context.runGraph
        .events()
        .some((event) => Number(event.graphRevision) === graphRevision);
      if (!explained)
        recorder.trigger({
          kind: "numerical-anomaly",
          tick: context.clock.tick,
          timeS: context.time,
          subjectId: `topology-revision:${graphRevision}`,
          validity: "measured",
        });
      this.lastGraphRevision = graphRevision;
    }

    context.telemetry.failureEvidence = recorder.completeTick({
      tick: context.clock.tick,
      timeS: context.time,
      contextTelemetry: {
        mobility: compactMobilityTelemetry(context.telemetry.mobility),
        graphRevision,
      },
    });
  }

  dispose() {
    this.positionsByAssembly?.clear();
  }
}
