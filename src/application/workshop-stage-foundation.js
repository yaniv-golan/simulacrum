import { createCelestialEnvironment } from "../presentation/celestial-environment.js";
import { LargeAssemblyBatcher } from "../presentation/large-assembly-batcher.js";
import {
  createWorkshopPlatform,
  createWorkshopScene,
} from "../presentation/workshop-scene.js";
import { createEarthEnvironmentModel } from "../simulation/environment/earth.js";
import {
  createEarthEnvironmentBodyRegistry,
  NEAR_SPACE_BODY_ID,
} from "../simulation/environment/earth-environment-bodies.js";
import { createWorkshopPhysicsWorld } from "./workshop-physics-world.js";

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

  let earthModel = createEarthEnvironmentModel();
  const earth = Object.freeze({
      localToGlobal: (x, z) => earthModel.localToGlobalSurface(x, z),
      pondAt: (x, z, margin = 1) => earthModel.pondAt(x, z, margin),
      terrainHeightAt: (x, z) => earthModel.terrainHeightAt(x, z),
      surfaceHeightAt: (x, z) => earthModel.surfaceHeightAt(x, z),
      rebuild: (east, north) => {
        earthModel = createEarthEnvironmentModel({
          originEastM: east,
          originNorthM: north,
        });
      },
    }),
    physics = createWorkshopPhysicsWorld({
      terrainHeightAt: earth.terrainHeightAt,
    }),
    largeAssemblyBatcher = new LargeAssemblyBatcher({
      machine: platform.machine,
    });
  return Object.freeze({
    ...sceneGraph,
    ...celestial,
    ...platform,
    ...physics,
    earth,
    environmentBodyRegistry,
    nearSpaceBodyId: NEAR_SPACE_BODY_ID,
    largeAssemblyBatcher,
    normalPixelRatio: Math.min(viewport.pixelRatio || 1, 2),
  });
}
