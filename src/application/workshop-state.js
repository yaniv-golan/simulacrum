import { createApplicationState } from "../model/application-state.js";
import {
  createDefaultControllerLayouts,
  normalizeControllerLayouts,
} from "../model/controller-layouts.js";
import { decodeLocalSubassemblyLibrary } from "../model/subassemblies.js";
import { BrowserStorage, STORAGE_KEYS } from "./browser-storage.js";
import {
  BrowserDiscoveryRepository,
  BrowserEnvironmentPreferencesRepository,
} from "./local-settings-repositories.js";
import {
  remoteProfilesFromTemplates,
  runtimeControlsFromProfiles,
} from "./remote-control-state.js";
export { STORAGE_KEYS } from "./browser-storage.js";
export function createWorkshopState({
  controlTemplates,
  defaultWatSource,
  defaultTsSource,
  defaultVisualProgram,
  storage = new BrowserStorage(),
  componentDetailQuality = "auto",
}) {
  if (!["auto", "hero", "performance"].includes(componentDetailQuality))
    throw new TypeError("Invalid componentDetailQuality");
  const newControllerSources = () => ({
      wat: defaultWatSource,
      typescript: defaultTsSource,
      visual: structuredClone(defaultVisualProgram),
    }),
    remoteProfiles = remoteProfilesFromTemplates(controlTemplates),
    localSubassemblies = decodeLocalSubassemblyLibrary(
      storage.readJson(STORAGE_KEYS.subassemblies, []),
    ),
    discovery = new BrowserDiscoveryRepository({ storage }).load(),
    environment = new BrowserEnvironmentPreferencesRepository({
      storage,
    }).load(),
    state = createApplicationState({
      editor: {
        mode: "build",
        tool: "select",
        placing: null,
        selected: null,
        selectedIds: new Set(),
        connectFrom: null,
        connectPort: null,
        cameraTool: null,
      },
      ui: { workspaceFocus: false },
      parts: [],
      connections: [],
      running: false,
      simulationPaused: false,
      timeScale: 1,
      componentDetailQuality,
      activeChallenge: null,
      challengeStatus: "idle",
      challengeProgress: 0,
      challengeHold: 0,
      challengeScore: 0,
      challengeBest: storage.readJson(STORAGE_KEYS.challengeBest, {}),
      challengeRecords: storage.readJson(STORAGE_KEYS.challengeRecords, []),
      challengeStartMode: null,
      learnTopic: "first-machine",
      learnCategory: "ALL",
      coachStep: 0,
      coachEnabled: discovery.tipsEnabled,
      tutorial: -1,
      elapsed: 0,
      demo: null,
      blueprintName: "Untitled machine",
      blueprintCreated: new Date().toISOString(),
      exploded: false,
      explodeAmount: 0,
      explodeCameraLift: 0,
      explodeFramingLift: 0,
      explodeDistanceLift: 0,
      custom: [...localSubassemblies.records],
      subassemblyRecoveryDiagnostics: [...localSubassemblies.diagnostics],
      remoteProfile: "cart",
      remoteEdit: false,
      capturingHotkey: null,
      remoteProfiles,
      remoteControls: runtimeControlsFromProfiles(remoteProfiles),
      remoteControlState: {},
      directSurfaces: { cart: true },
      controllerWindowState: {
        visible: true,
        collapsed: false,
        pinned: false,
        x: 24,
        y: 24,
        width: 360,
        height: 520,
      },
      controllerLayouts: normalizeControllerLayouts(
        Object.fromEntries(
          Object.entries(remoteProfiles).map(([profileId, profile]) => [
            profileId,
            profile.design,
          ]),
        ) || createDefaultControllerLayouts(),
      ),
      scriptLanguage: "visual",
      scriptSources: newControllerSources(),
      scriptControllerId: null,
      blueprintExtensions: {},
      loadFrozen: false,
      timeOfDay: environment.timeOfDay,
      windEnabled: environment.windEnabled,
      earthOriginEastM: 0,
      earthOriginNorthM: 0,
      testDeployment: null,
      activeTestRouteId: null,
      spaceBlend: 0,
    });
  return Object.freeze({ storage, state, newControllerSources });
}
