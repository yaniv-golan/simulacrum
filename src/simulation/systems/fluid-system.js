/** Applies depth-derived displaced volume, buoyancy, and hydrodynamic drag. */
export class FluidSystem {
  phase = "environment";

  step(context, dt) {
    const compiledRuntime = context.services.multibodyRuntime;
    if (compiledRuntime?.compiled) {
      context.telemetry.fluids = compiledRuntime.applyFluidForces(dt);
    }
    context.services.stepOtherFluids?.(context, dt);
  }
}
