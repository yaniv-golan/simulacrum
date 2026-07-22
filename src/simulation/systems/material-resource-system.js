import { MaterialResourceNetwork } from "../material-resource-network.js";

/** Resolves finite material ownership without applying forces. */
export class MaterialResourceSystem {
  phase = "networks";

  initialize(context) {
    context.materialResourceNetwork = new MaterialResourceNetwork(
      context.services.compiledAssembly,
    );
  }

  step(context) {
    context.materialResourceNetwork.resolve(context.runGraph);
    context.telemetry.materialResources =
      context.materialResourceNetwork.telemetry();
  }

  dispose(context) {
    delete context.materialResourceNetwork;
  }
}

/**
 * Reprojects topology after structural mutations in the same completed tick.
 * Allocation already completed before integration; this system only exposes
 * structural partitions in the same completed tick.
 */
export class MaterialResourceCommitSystem {
  phase = "structures";

  step(context) {
    context.materialResourceNetwork?.resolve(context.runGraph);
    if (context.materialResourceNetwork)
      context.telemetry.materialResources =
        context.materialResourceNetwork.telemetry();
  }
}
