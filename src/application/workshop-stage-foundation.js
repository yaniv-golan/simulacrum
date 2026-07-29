import { createCelestialEnvironment } from "../presentation/celestial-environment.js";
import { ComponentDetailController } from "../presentation/component-detail-controller.js";
import { LargeAssemblyBatcher } from "../presentation/large-assembly-batcher.js";
import {
  createWorkshopPlatform,
  createWorkshopScene,
} from "../presentation/workshop-scene.js";
import {
  createEarthEnvironmentBodyRegistry,
  NEAR_SPACE_BODY_ID,
} from "../simulation/environment/earth-environment-bodies.js";
import { createWorkshopPhysicsWorld } from "./workshop-physics-world.js";
import { createTestingPlaygroundEnvironment } from "./testing-playground-environment.js";

/** Constructs the engine-backed stage and exposes environment queries as ports. */
export function createWorkshopStageFoundation({
  stage,
  viewport,
  landPolygons,
  karmanLineM,
}) {
  const sceneGraph = createWorkshopScene({
      stage,
      width: viewport.width,
      height: viewport.height,
      pixelRatio: viewport.pixelRatio,
    }),
    environmentBodyRegistry = createEarthEnvironmentBodyRegistry({
      karmanLineM,
    }),
    nearSpaceBody = environmentBodyRegistry
      .snapshot()
      .bodies.find((body) => body.id === NEAR_SPACE_BODY_ID),
    celestial = createCelestialEnvironment({
      scene: sceneGraph.scene,
      landPolygons,
      environmentBody: nearSpaceBody,
    }),
    platform = createWorkshopPlatform({ scene: sceneGraph.scene });

  const earth = createTestingPlaygroundEnvironment(),
    physics = createWorkshopPhysicsWorld({
      surfaceSampleAt: earth.surfaceSampleAt,
      footprint: earth.testSite.footprint,
    }),
    largeAssemblyBatcher = new LargeAssemblyBatcher({
      machine: platform.machine,
    }),
    componentDetail = new ComponentDetailController();
  return Object.freeze({
    ...sceneGraph,
    ...celestial,
    ...platform,
    ...physics,
    earth,
    environmentBodyRegistry,
    nearSpaceBodyId: NEAR_SPACE_BODY_ID,
    largeAssemblyBatcher,
    componentDetail,
    normalPixelRatio: Math.min(viewport.pixelRatio || 1, 2),
  });
}
