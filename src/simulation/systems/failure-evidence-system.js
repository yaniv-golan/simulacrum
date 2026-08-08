import { invalidMultibodyFailureEvidenceCandidate } from "../multibody-runtime.js";
import { bodyRegistryBodyRecords } from "../body-registry.js";

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
    this.shaftHistoryByMotor = new Map();
    this.lastGraphRevision = Number(context?.runGraph?.graphRevision || 0);
  }

  step(context) {
    const recorder = context.services.failureEvidenceRecorder;
    if (!recorder) return;
    if (!recorder.acceptingEvidence()) {
      context.telemetry.failureEvidence = {
        ...recorder.telemetrySummary(),
        captureStatus:
          context.services.failureEvidenceCaptureStatus?.() || null,
      };
      return;
    }
    const policy = recorder.policy,
      assemblies = context.telemetry.mobility?.assemblies || [],
      liveMotorIds = new Set();
    for (const assembly of assemblies) {
      const assemblyId = String(assembly.assemblyId);
      if (!finiteMobility(assembly))
        recorder.trigger({
          kind: "numerical-anomaly",
          tick: context.clock.tick,
          timeS: context.time,
          subjectId: assemblyId,
          validity: "measured",
        });
      const touching = (assembly.wheelStates || []).some(
        (wheel) => wheel.touching,
      );
      for (const motor of assembly.driveForce?.motors || []) {
        const motorId = `${assemblyId}:${String(motor.partId)}`,
          command = Number(motor.resolvedThrottle || 0),
          candidate =
            Math.abs(command) >= policy.stallCommandAbsMin &&
            motor.operational === true &&
            Number(motor.availablePowerW || 0) >= policy.stallPowerFloorW &&
            assembly.grounded &&
            touching &&
            Number(assembly.brake || 0) <= 0.05,
          history = this.shaftHistoryByMotor.get(motorId) || [];
        liveMotorIds.add(motorId);
        if (!candidate) {
          this.shaftHistoryByMotor.delete(motorId);
          continue;
        }
        const direction = Math.sign(command),
          previousDirection = history.at(-1)?.direction;
        if (previousDirection != null && previousDirection !== direction)
          history.length = 0;
        const positionRad = Number(motor.shaftPositionRad || 0),
          previousPositionRad = history.at(-1)?.positionRad;
        history.push({
          tick: context.clock.tick,
          positionRad,
          progressRad:
            previousPositionRad == null
              ? 0
              : Math.abs(positionRad - previousPositionRad),
          direction,
        });
        if (history.length > policy.stallDwellTicks)
          history.splice(0, history.length - policy.stallDwellTicks);
        this.shaftHistoryByMotor.set(motorId, history);
        if (
          history.length === policy.stallDwellTicks &&
          history.reduce(
            (total, sample) => total + Number(sample.progressRad || 0),
            0,
          ) <= policy.stallShaftProgressMinRad
        )
          recorder.trigger({
            kind: "rolling-actuator-stall",
            tick: context.clock.tick,
            timeS: context.time,
            subjectId: motor.partId,
            validity: "measured",
          });
      }
    }
    for (const motorId of this.shaftHistoryByMotor.keys())
      if (!liveMotorIds.has(motorId)) this.shaftHistoryByMotor.delete(motorId);

    for (const body of bodyRegistryBodyRecords(context.bodyRegistry))
      for (const contact of body.contacts)
        if (
          contact.tireEvidence?.withinGeometricTolerance === false &&
          Number(contact.forceN || 0) >= policy.contactInvariantLoadFloorN
        )
          recorder.trigger({
            kind: "contact-invariant",
            tick: context.clock.tick,
            timeS: context.time,
            subjectId: contact.tireEvidence.tirePartId,
            validity: contact.tireEvidence.validity,
          });
    const invalidContribution = invalidMultibodyFailureEvidenceCandidate(
      context.services.multibodyRuntime,
    );
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
    const contextTelemetry = {
      mobility: compactMobilityTelemetry(context.telemetry.mobility),
      graphRevision,
    };
    let summary = recorder.completeTick({
      tick: context.clock.tick,
      timeS: context.time,
      contextTelemetry,
    });
    if (
      summary.captureState === "captured" &&
      context.services.finalizeFailureEvidenceEpisode
    ) {
      const result = context.services.finalizeFailureEvidenceEpisode(
        recorder.snapshot(),
      );
      if (result?.rearm) {
        recorder.rearmEpisode({
          priorEpisodeBoundaries: result.priorEpisodeBoundaries,
        });
        this.shaftHistoryByMotor.clear();
        summary = recorder.telemetrySummary();
      }
    }
    context.telemetry.failureEvidence = {
      ...summary,
      captureStatus: context.services.failureEvidenceCaptureStatus?.() || null,
    };
  }

  dispose() {
    this.shaftHistoryByMotor?.clear();
  }
}
