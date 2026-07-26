import { DomainValidationError } from "../model/primitives.js";
import { composeConfiguredControlChainExplanation } from "./component-route-explanation.js";

/**
 * Keeps late-bound feature ports out of the startup coordinator. The getters
 * preserve construction order without creating a service locator: each method
 * exposes one declared workshop use case.
 */
export function createWorkshopCoordinatorPorts({
  state,
  runtime,
  workspace,
  editor,
  simulation,
  history,
}) {
  async function traceComponentRoute(query) {
    if (!state.running) {
      const expected = await workspace().authoredRouteIdentity(query.kind);
      return workspace().routeEvidence(query, expected);
    }
    const descriptor = runtime.telemetry?.systems?.routeEvidence,
      slotName =
        query.kind === "resource-reachability"
          ? "resourceReachability"
          : query.kind === "resource-allocation"
            ? "resourceAllocation"
            : query.kind,
      slot = descriptor?.slots?.[slotName];
    if (!descriptor?.token || slot?.status !== "available")
      return {
        status: slot?.status || "unsupported",
        hops: [],
        identity: slot?.identity || null,
      };
    return runtime.session.routeEvidence(
      descriptor.token,
      query,
      slot.identity,
    );
  }

  return Object.freeze({
    buildHistoryState(snapshot) {
      return snapshot === undefined
        ? history().capture()
        : history().restore(snapshot);
    },
    refreshHistoryUI: () => history().refresh(),
    recordHistory: (label, snapshot = null) =>
      history().record(label, snapshot),
    startSimulation: (preserveBaseline = false) =>
      simulation().start(preserveBaseline),
    stopSimulation: () => simulation().stop(),
    resetSimulation: () => simulation().reset(),
    destroyComponentFlightPhysics: () => simulation()?.destroyFlightPhysics(),
    syncAssemblyModel: () => workspace().sync(),
    currentConnections: () =>
      workspace()?.currentConnections() || state.connections,
    currentPart: (id) =>
      workspace()?.currentPart(id) ||
      state.parts.find((part) => part.id === id) ||
      null,
    configuredControlChainOptions: (partId) =>
      workspace()?.configuredControlChainOptions(partId) || {
        status: "unsupported",
        totalCount: 0,
        options: [],
      },
    routeTargetOptions: (query) =>
      workspace()?.routeTargetOptions(query) || {
        status: "unsupported",
        totalCount: 0,
        options: [],
      },
    disconnectConnection: (connectionId) =>
      editor()?.disconnectConnection(connectionId) || false,
    traceComponentRoute,
    async traceConfiguredControlChain({
      controllerPartId,
      inputBinding,
      outputBinding,
    }) {
      if (
        !Number.isSafeInteger(controllerPartId) ||
        inputBinding?.direction !== "input" ||
        outputBinding?.direction !== "output"
      )
        throw new DomainValidationError(
          "INVALID_CONFIGURED_CONTROL_CHAIN",
          "Configured control chains require one input and one output binding from one controller",
        );
      const inputQuery = {
          version: 1,
          kind: "signal",
          source: {
            partId: inputBinding.endpointPartId,
            portId: inputBinding.endpointPortId,
          },
          target: { partId: controllerPartId, portId: null },
        },
        outputQuery = {
          version: 1,
          kind: "signal",
          source: { partId: controllerPartId, portId: null },
          target: {
            partId: outputBinding.endpointPartId,
            portId: outputBinding.endpointPortId,
          },
        };
      let inputWitness, outputWitness;
      if (!state.running) {
        const expected = await workspace().authoredRouteIdentity("signal");
        [inputWitness, outputWitness] = await Promise.all([
          workspace().routeEvidence(inputQuery, expected),
          workspace().routeEvidence(outputQuery, expected),
        ]);
      } else {
        const descriptor = runtime.telemetry?.systems?.routeEvidence,
          slot = descriptor?.slots?.signal;
        if (descriptor?.token && slot?.status === "available") {
          inputWitness = runtime.session.routeEvidence(
            descriptor.token,
            inputQuery,
            slot.identity,
          );
          outputWitness = runtime.session.routeEvidence(
            descriptor.token,
            outputQuery,
            slot.identity,
          );
        } else {
          inputWitness = {
            status: slot?.status || "unsupported",
            identity: slot?.identity || null,
            hops: [],
          };
          outputWitness = structuredClone(inputWitness);
        }
      }
      return composeConfiguredControlChainExplanation({
        inputBinding,
        outputBinding,
        inputWitness,
        outputWitness,
      });
    },
  });
}
