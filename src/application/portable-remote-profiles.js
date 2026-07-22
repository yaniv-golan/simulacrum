/**
 * Build the portable remote-profile DTO from the current editor read model.
 * Runtime control values and window state deliberately remain outside it.
 */
export function portableRemoteProfilesFromState(state) {
  return structuredClone(state.remoteProfiles || {});
}
