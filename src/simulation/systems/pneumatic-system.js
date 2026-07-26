import { PneumaticNetwork } from "../pneumatic-network.js";

/** Resolves powered gas transfer before tire contact is solved. */
export class PneumaticSystem {
  phase = "actuators";

  initialize(context) {
    context.pneumaticNetwork = new PneumaticNetwork(
      context.services.compiledAssembly,
    );
    context.initialSystemTelemetry ||= {};
    context.initialSystemTelemetry.pneumatics =
      context.pneumaticNetwork.telemetry();
  }

  step(context, dt) {
    const network = context.pneumaticNetwork,
      runtime = context.services.multibodyRuntime;
    network.resolve(context, dt);
    network.forEachChamberState((partId, state, ambientPressurePa) =>
      runtime?.setTirePneumaticGasState?.(partId, state, 0, ambientPressurePa),
    );
  }

  afterCheckpointRestore(context) {
    context.pneumaticNetwork?.forEachChamberState(
      (partId, state, ambientPressurePa) =>
        context.services.multibodyRuntime?.setTirePneumaticGasState?.(
          partId,
          state,
          0,
          ambientPressurePa,
        ),
    );
  }

  dispose(context) {
    delete context.pneumaticNetwork;
  }
}

/** Commits tire volume work and heat after the completed contact solve. */
export class PneumaticCommitSystem {
  phase = "thermal";

  step(context, dt) {
    const network = context.pneumaticNetwork,
      runtime = context.services.multibodyRuntime;
    runtime?.forEachTireMechanicalState?.((partId, mechanicalState) => {
      const committed = network.commitMechanicalState(
        partId,
        mechanicalState,
        dt,
        context.time,
      );
      if (committed)
        runtime.setTirePneumaticGasState(
          partId,
          committed.state,
          committed.heatToCarcassJ,
          committed.ambientPressurePa,
        );
    });
    network.commitStaticThermal(dt);
    context.telemetry.pneumatics = network.telemetry();
  }
}

/** Commits pressure-rated line failures in the ordinary structure phase. */
export class PneumaticStructureSystem {
  phase = "structures";

  step(context) {
    context.pneumaticNetwork?.commitStructuralFailures(context);
  }
}
