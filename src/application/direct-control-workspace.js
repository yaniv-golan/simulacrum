import { remoteActionTargetPartIds } from "../model/remote-actions.js";

/**
 * Restricts the direct-control feature to the editor state it is allowed to
 * observe. Getters keep the port live without exposing mutation methods.
 */
export function createDirectControlWorkspace(state, telemetry) {
  return Object.freeze({
    get parts() {
      return state.parts;
    },
    get remoteProfile() {
      return state.remoteProfile;
    },
    get remoteControls() {
      return state.remoteControls;
    },
    get remoteProfiles() {
      return state.remoteProfiles;
    },
    get directSurfaces() {
      return state.directSurfaces;
    },
    get controllerLayouts() {
      return state.controllerLayouts;
    },
    get running() {
      return state.running;
    },
    get exploded() {
      return state.exploded;
    },
    get speedMps() {
      const systems = telemetry()?.systems;
      const profile = state.remoteProfiles[state.remoteProfile],
        controls = state.remoteControls[state.remoteProfile] || [],
        targetIds = new Set(remoteActionTargetPartIds(profile, controls)),
        mobility = systems?.mobility?.assemblies?.find((assembly) =>
          assembly.memberPartIds.some((id) => targetIds.has(id)),
        );
      return mobility?.signedSpeed ?? 0;
    },
  });
}
