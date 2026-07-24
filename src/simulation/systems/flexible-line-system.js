/** Applies flexible internal forces before the shared integration transaction. */
export class FlexibleLineSystem {
  phase = "actuators";

  initialize(context) {
    context.services.flexibleLineRuntime?.registerBodyEntities(
      context.bodyRegistry,
    );
  }

  step(context, dt) {
    context.services.flexibleLineRuntime?.beforeIntegration(dt);
  }
}

/** Measures solved loads/failures before the ordinary structure owner runs. */
export class FlexibleLineStructureSystem {
  phase = "structures";

  step(context) {
    const runtime = context.services.flexibleLineRuntime;
    if (!runtime) return;
    const telemetry = runtime.afterIntegration(context.clock.tick, {
      windEnabled: Boolean(context.services.windEnabled),
      pondAt: context.services.pondAt,
    });
    for (const event of telemetry.topologyEvents)
      context.runGraph.applyStructuralEvent({
        failedConnectionIds:
          event.kind === "flexible-attachment-break-v1"
            ? [event.sourceConnectionId]
            : [],
        failedInternalEdgeIds:
          event.kind === "flexible-internal-break-v1"
            ? [event.internalEdgeId]
            : [],
        reason:
          event.kind === "flexible-attachment-break-v1"
            ? "measured Rope attachment reaction exceeded capacity"
            : "measured Rope material tension exceeded strength",
        mode: event.kind,
        time: context.time,
      });
    context.flexibleLineDraft = telemetry;
  }
}

/** Publishes the post-failure boundary state from the same completed tick. */
export class FlexibleLineTelemetrySystem {
  phase = "structures";

  step(context) {
    const runtime = context.services.flexibleLineRuntime;
    if (!runtime) return;
    const refreshed = runtime.afterIntegration(context.clock.tick, {
        windEnabled: Boolean(context.services.windEnabled),
        pondAt: context.services.pondAt,
      }),
      topologyEvents = context.flexibleLineDraft?.topologyEvents || [];
    context.telemetry.flexibleLines = {
      ...refreshed,
      topologyEvents,
    };
    delete context.flexibleLineDraft;
  }
}
