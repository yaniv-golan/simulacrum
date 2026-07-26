// Stable, DOM-free reuse surface for tools, alternate front ends, and tests.
export { AssemblyModel } from "../model/assembly-model.js";
export {
  createSubassemblyTemplate,
  createLocalSubassemblyRecord,
  decodeLocalSubassemblyLibrary,
  decodeSubassembly,
  decodeSubassemblyOrThrow,
  instantiateSubassembly,
  LOCAL_SUBASSEMBLY_FORMAT,
  LOCAL_SUBASSEMBLY_VERSION,
  SUBASSEMBLY_FORMAT,
  SUBASSEMBLY_VERSION,
} from "../model/subassemblies.js";
export {
  analyzeAssembly,
  displacedVolumeForPart,
} from "../model/engineering-analysis.js";
export { FailureRecorder, ReplayBuffer } from "../model/failure-analysis.js";
export { FailureEvent } from "../model/failure-event-extractors.js";
export { ControllerTraceBuffer } from "../model/controller-debugger.js";
export { SENSOR_PART_DEFINITIONS } from "../model/sensor-contracts.js";
export {
  ENVIRONMENT_BODY_FRAMES,
  ENVIRONMENT_BODY_QUERY_KINDS,
  environmentBodyDescriptor,
} from "../model/environment-body-contracts.js";
export { rangeSensorContract } from "../model/range-sensor-contracts.js";
export {
  canonicalControllerBindings,
  controllerBindingIndex,
  controllerBindingManifest,
  controllerBindingManifestIdentity,
  controllerBindingOptions,
  CONTROLLER_BINDING_DIRECTIONS,
  remapControllerBindings,
  validateControllerBindingManifest,
} from "../model/controller-bindings.js";
export {
  compileVisualProgram,
  DEFAULT_VISUAL_PROGRAM,
  normalizeVisualProgram,
  VISUAL_PROGRAM_VERSION,
} from "../model/visual-logic.js";
export {
  CONTROL_IR_VERSION,
  validateControlIR,
} from "../model/control-program-ir.js";
export {
  CONTROLLER_CHANNELS,
  CONTROLLER_LIMITS,
  CONTROLLER_POLICY_VERSION,
} from "../model/controller-policy.js";
export { ChallengeRun, challengeReliability } from "../model/challenge-lab.js";
export { ChallengeBindingResolver } from "../model/challenge-binding-resolver.js";
export { physicalComponents } from "../model/physical-components.js";
export {
  BLUEPRINT_FORMAT,
  BLUEPRINT_VERSION,
  createBlueprint,
  normalizeBlueprint,
} from "../model/blueprints.js";
export {
  AUTHORED_ASSEMBLY_CONTENT_VERSION,
  decodeAuthoredAssemblyContentOrThrow,
  projectPortableAuthoredConnection,
  projectPortableAuthoredPart,
} from "../model/authored-assembly-content.js";
export {
  COMPONENT_INSPECTION_FINGERPRINT_VERSION,
  componentInspectionAssemblyFingerprintBytes,
  fingerprintComponentInspectionAssembly,
} from "../model/component-inspection-fingerprint.js";
export {
  COMPONENT_RELATIONSHIP_INDEX_VERSION,
  ComponentRelationshipIndex,
} from "../model/component-relationships.js";
export {
  COMPONENT_PREFLIGHT_VERSION,
  analyzeComponentPreflight,
} from "../model/component-preflight.js";
export {
  decodeBlueprint,
  decodeBlueprintOrThrow,
} from "../model/blueprint-decoder.js";
export {
  canonicalId,
  deepFreeze,
  DomainValidationError,
  errorMessage,
  finiteNumber,
  finiteScale3,
  finiteVector3,
  immutableClone,
  normalizeTransform,
  stableStringify,
} from "../model/primitives.js";
export {
  componentDefaults,
  resolveComponentConfig,
  resolveWireComponentConfig,
  splitComponentConfig,
} from "../model/component-resolver.js";
export {
  geometryDescriptorForPart,
  geometryDescriptorForType,
} from "../model/geometry-descriptors.js";
export * from "../model/component-geometry-contract.js";
export { HistoryStore } from "../model/history-store.js";
export {
  alignSelection,
  distributeSelection,
  selectionPivot,
  translateSelectionTo,
} from "../model/selection-transforms.js";
export {
  CONTROLLER_STYLES,
  createDefaultControllerLayouts,
  normalizeControllerLayouts,
} from "../model/controller-layouts.js";
export {
  defaultActionBinding,
  REMOTE_ACTIONS,
  remoteActionTargetPartIds,
  resolveRemoteAction,
  resolveRemoteActionState,
  validateRemoteActionBindings,
} from "../model/remote-actions.js";
export { TYPES, FLIGHT_MATERIALS } from "../model/component-catalog.js";
export {
  completeConnectionContract,
  CONNECTION_CAPACITIES,
  isPhysicalConnectionKind,
  localAttachmentAnchor,
} from "../model/connection-contracts.js";
export {
  compatibleTargetPorts,
  connectionUsesPort,
  inferConnectionKind,
  portDefinition,
  portIds,
  portPresentation,
  portsCompatible,
  selectCompatibleTargetPort,
  validatePortConnection,
} from "../model/ports.js";
export {
  SimulationSession,
  SIMULATION_PHASES,
} from "../simulation/simulation-session.js";
export { createTelemetrySnapshot } from "../simulation/telemetry.js";
export { RunAssemblyGraph } from "../simulation/run-assembly-graph.js";
export { PhysicalAssemblyIndex } from "../simulation/physical-assembly-index.js";
export { BodyRegistry } from "../simulation/body-registry.js";
export { CannonWorldAdapter } from "../simulation/cannon-world-adapter.js";
export { CannonMaterialAdapter } from "../simulation/cannon-material-adapter.js";
export { FlexibleLineRuntime } from "../simulation/flexible-line-runtime.js";
export { TensionOnlyDistanceConstraint } from "../simulation/tension-only-distance-constraint.js";
export {
  CANNON_SOLVER_TRANSACTION_ID,
  CannonSolverTransaction,
} from "../simulation/cannon-solver-transaction.js";
export { RuntimeCheckpointCoordinator } from "../simulation/runtime-checkpoints.js";
export { CommandBus } from "../simulation/command-bus.js";
export {
  ACTUATOR_CHANNELS,
  acceptsActuatorChannel,
  actuatorChannel,
  clampActuatorCommand,
  powerContract,
  readActuatorCommand,
  sourcePowerContract,
  targetTypesForChannel,
} from "../model/actuator-contracts.js";
export {
  batteryEnergyReadModel,
  JOULES_PER_WATT_HOUR,
  joulesToWattHours,
  runtimeBatteryEnergy,
  wattHoursToJoules,
} from "../simulation/energy-ledger.js";
export { PowerNetwork } from "../simulation/power-network.js";
export { SignalNetwork } from "../simulation/signal-network.js";
export { MaterialResourceNetwork } from "../simulation/material-resource-network.js";
export { materialStoreContract } from "../model/material-resource-contracts.js";
export { MATERIAL_MEDIA, materialMedium } from "../model/material-media.js";
export {
  pressureNozzleContract,
  pressureNozzlePerformance,
} from "../model/pressure-nozzle-contracts.js";
export { deriveDynamicMassProperties } from "../model/dynamic-mass-properties.js";
export { wheelDriveMotorIds } from "../simulation/wheel-drive-topology.js";
export { compileAssembly } from "../model/assembly-compiler.js";
export {
  FLEXIBLE_LINE_MATERIALS,
  expandFlexibleLineMaterial,
  flexibleLineMaterial,
  validateFlexibleLineConfig,
} from "../model/flexible-line-materials.js";
export {
  MultibodyRuntime,
  startMultibodyRuntime,
} from "../simulation/multibody-runtime.js";
export {
  standardAtmosphere,
  projectedBoxArea,
} from "../simulation/environment/atmosphere.js";
export { sampleWindVelocity } from "../simulation/environment/wind-field.js";
export {
  EnvironmentBodyRegistry,
  measureEnvironmentProximity,
} from "../simulation/environment/environment-body-registry.js";
export { ControllerRuntimeManager } from "../scripting/controller-runtime-manager.js";
export {
  compileControlIRToWat,
  compileTypeScriptToControlIR,
  prepareControlIRController,
  prepareTypeScriptController,
  prepareWasmController,
} from "../scripting/controller-compilers.js";
export { ControllerSensorBank } from "../simulation/controller-sensors.js";
export {
  SHARE_FORMAT,
  SHARE_VERSION,
  SHARE_KINDS,
  createSharePackage,
  decodeSharePackage,
} from "../model/share-packages.js";
export { fingerprintAsset } from "../model/portable-asset-identity.js";
export { ShareLibrary } from "../model/share-library.js";
export {
  decodeSharePayload,
  encodeSharePayload,
  parseSharedText,
  portableShareCopy,
  readShareUrl,
} from "../model/share-codec.js";
export * from "../simulation/systems/index.js";
