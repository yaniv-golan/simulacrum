import {
  REMOTE_ACTIONS,
  resolveRemoteAction,
} from "../model/remote-actions.js";

/**
 * @typedef {{
 *   label:string,channel:string,type:string,value:number,active?:boolean,
 *   targetId?:number,bindingStatus?:string,
 * }} DebugRemoteControl
 * @typedef {{
 *   id:number, programAcquisition?:string|null,
 *   programTrust?:{allowed?:boolean,requiresReview?:boolean,status?:string,digest?:string}|null,
 * }} DebugController
 * @typedef {{ controllerId:number,ready:boolean,commands?:Record<string,number> }} DebugControllerRuntime
 * @typedef {{
 *   profile:string, profileDefinition:unknown, controls:DebugRemoteControl[], layout:unknown,
 *   directVisible:boolean,directPinned:boolean,language:string,
 *   controller:DebugController|null,powered:boolean,signalOutputs:number,
 *   runtimes:DebugControllerRuntime[],conflicts:unknown[],status:string|null,
 *   visualNodes:number,debug:unknown,
 * }} ControllerDebugInput
 */

/** @param {ControllerDebugInput} input */
export function buildControllerDebugReadModel(input) {
  const actions = Object.fromEntries(
    REMOTE_ACTIONS.map((action) => {
      const resolved = resolveRemoteAction(
        input.profileDefinition,
        input.controls,
        action,
        true,
      );
      return [
        action,
        {
          controlId: resolved.control?.id || null,
          status:
            resolved.status === "ready"
              ? resolved.control.bindingStatus || "unbound"
              : resolved.status,
          value: resolved.value,
        },
      ];
    }),
  );
  return {
    remote: {
      profile: input.profile,
      controls: input.controls.map((control) => ({
        label: control.label,
        channel: control.channel,
        type: control.type,
        value: control.value,
        active: Boolean(control.active),
        targetId: control.targetId,
        bindingStatus: control.bindingStatus || "unbound",
        online: control.bindingStatus === "online",
      })),
    },
    directSurface: {
      profile: input.profile,
      layout: structuredClone(input.layout),
      visible: input.directVisible,
      pinned: input.directPinned,
      actions,
      controls: input.controls.map((control) => ({
        label: control.label,
        channel: control.channel,
        type: control.type,
        value: control.value,
      })),
    },
    script: {
      language: input.language,
      controllerId: input.controller?.id || null,
      acquisition: input.controller?.programAcquisition || null,
      trust: input.controller?.programTrust
        ? {
            allowed: input.controller.programTrust.allowed,
            requiresReview: input.controller.programTrust.requiresReview,
            status: input.controller.programTrust.status,
            digest: input.controller.programTrust.digest,
          }
        : null,
      controllerPowered: input.powered,
      signalOutputs: input.signalOutputs,
      running: input.runtimes.some((runtime) => runtime.ready),
      commands:
        input.runtimes.find(
          (runtime) => runtime.controllerId === input.controller?.id,
        )?.commands || {},
      runtimes: structuredClone(input.runtimes),
      conflicts: structuredClone(input.conflicts),
      status: input.status,
      visualNodes: input.visualNodes,
      debug: input.debug,
    },
  };
}
