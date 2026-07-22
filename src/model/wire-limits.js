export const WIRE_LIMITS = Object.freeze({
  blueprintBytes: 2_000_000,
  workspaceBytes: 2_500_000,
  portableAssetBytes: 2_000_000,
  runConfigurationBytes: 256_000,
  inputTraceBytes: 8_000_000,
  checkpointBytes: 32_000_000,
  experimentBytes: 48_000_000,
  telemetryPlaybackBytes: 32_000_000,
  mechanismAuthoredComponentBytes: 2_000_000,
  maxDepth: 64,
  maxNodes: 100_000,
  maxParts: 300,
  maxConnections: 3_000,
  maxProfiles: 64,
  maxControlsPerProfile: 128,
  maxScriptBytes: 32 * 1024,
  extensionDepth: 8,
  extensionNodes: 256,
  extensionBytes: 16 * 1024,
});

export const IDENTIFIER_PATTERN = "^[A-Za-z0-9._:-]{1,64}$";
export const EXTENSION_NAMESPACE_PATTERN =
  "^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$";
