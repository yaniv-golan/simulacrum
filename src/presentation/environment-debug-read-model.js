import { CLOUD_LAYERS } from "./atmospheric-landmarks.js";
import { testSiteHeightFeatureExtrema } from "../model/test-site-terrain.js";
import { compileTestSiteVegetation } from "../model/test-site-vegetation.js";

/**
 * @typedef {{ x:number,y:number,z:number }} EnvironmentVector
 * @typedef {{
 *   key:string, signature:string, biome:string, treeCount:number,
 *   waterFraction:number, collisionBody?:unknown,
 * }} EnvironmentChunk
 * @typedef {{
 *   focus:{x:number,z:number}, origin:{eastM:number,northM:number},
 *   localToGlobal:(x:number,z:number)=>{eastM:number,northM:number},
 *   localSurfaceSample?:(x:number,z:number)=>{heightM:number,materialKey:string,districtId:string|null,featureIds:string[]}|null,
 *   chunks:EnvironmentChunk[], timeOfDay:number, sunElevationDeg:number,
 *   detailLod?:()=>{level:string,grassBladesVisible:number,fixtureVisualsVisible:boolean,surfaceRegionsVisible:boolean},
 *   spaceBlend:number, skyColor:string, windEnabled:boolean, elapsed:number,
 *   starOpacity:number, moonOpacity:number, earthOpacity:number,
 *   meteorite:EnvironmentVector,
 *   environment:{
 *     buildSiteLatDeg:number, buildSiteLonDeg:number, chunkSizeM:number,
 *     earthRadiusM:number, fieldSurfaceY:number, karmanLineM:number,
 *     moonDistanceM:number,
 *     pondSpecs:Array<{id:string,x:number,z:number,rx:number,rz:number,depth:number,waterY:number}>,
 *     testSite:{id:string,footprint:{centerM:number[],sizeM:number[]},districts:object[],surfaceRegions:object[],heightFeatures:object[],fluidRegions:object[],clearVolumes:object[],staticFixtures:Array<{presentation:{key:string},collisionGeometry:{kind:string}}>},
 *     globalToGeodetic:(eastM:number,northM:number)=>{latitude:number,longitude:number},
 *     surfaceSample:(eastM:number,northM:number)=>{biome:string,elevation:number},
 *     sampleWind:(position:EnvironmentVector, options:{enabled:boolean,elapsedSeconds:number})=>EnvironmentVector,
 *   },
 * }} EnvironmentDebugInput
 */

/** @param {EnvironmentVector} velocity */
function windReading(velocity) {
  return {
    x: +velocity.x.toFixed(2),
    y: +velocity.y.toFixed(2),
    z: +velocity.z.toFixed(2),
    speed: +Math.hypot(velocity.x, velocity.z).toFixed(2),
  };
}

/** @param {EnvironmentDebugInput} input */
export function buildEnvironmentDebugReadModel(input) {
  const environment = input.environment,
    testSiteVegetation = compileTestSiteVegetation(environment.testSite),
    global = input.localToGlobal(input.focus.x, input.focus.z),
    geodetic = environment.globalToGeodetic(global.eastM, global.northM),
    globalSurface = environment.surfaceSample(global.eastM, global.northM),
    localSurface = input.localSurfaceSample?.(input.focus.x, input.focus.z),
    windOptions = {
      enabled: input.windEnabled,
      elapsedSeconds: input.elapsed,
    },
    generatedFeatures = input.chunks.reduce(
      (summary, chunk) => {
        summary.trees += chunk.treeCount;
        summary.waterCoverage += chunk.waterFraction;
        summary.biomes[chunk.biome] = (summary.biomes[chunk.biome] || 0) + 1;
        return summary;
      },
      /** @type {{trees:number,waterCoverage:number,biomes:Record<string,number>}} */ ({
        trees: 0,
        waterCoverage: 0,
        biomes: {},
      }),
    );
  return {
    platform: { width: 44, depth: 44, topY: 0 },
    earth: {
      radiusM: environment.earthRadiusM,
      circumferenceM: +(2 * Math.PI * environment.earthRadiusM).toFixed(0),
      landSource: "Natural Earth 1:110m",
      referenceCoordinate: {
        latitude: environment.buildSiteLatDeg,
        longitude: environment.buildSiteLonDeg,
      },
      currentCoordinate: {
        latitude: +geodetic.latitude.toFixed(7),
        longitude: +geodetic.longitude.toFixed(7),
      },
      globalOffsetM: {
        east: +input.origin.eastM.toFixed(1),
        north: +input.origin.northM.toFixed(1),
      },
      currentBiome: localSurface?.materialKey || globalSurface.biome,
      currentElevationM: +(
        localSurface?.heightM ?? globalSurface.elevation
      ).toFixed(2),
      chunkSizeM: environment.chunkSizeM,
      activeChunks: input.chunks.length,
      collisionChunks: input.chunks.filter((chunk) =>
        Boolean(chunk.collisionBody),
      ).length,
      generatedFeatures,
      activeTileSignatures: [...input.chunks]
        .sort((left, right) => left.key.localeCompare(right.key))
        .map((chunk) => ({
          key: chunk.key,
          signature: chunk.signature,
          biome: chunk.biome,
          trees: chunk.treeCount,
          waterFraction: +chunk.waterFraction.toFixed(3),
        })),
    },
    fieldSurfaceY: environment.fieldSurfaceY,
    timeOfDay: +input.timeOfDay.toFixed(2),
    sunElevationDeg: +(input.sunElevationDeg || 0).toFixed(2),
    spaceBlend: +input.spaceBlend.toFixed(3),
    skyColor: input.skyColor,
    wind: {
      enabled: input.windEnabled,
      surface10m: windReading(
        environment.sampleWind({ x: 0, y: 10, z: 0 }, windOptions),
      ),
      jet10km: windReading(
        environment.sampleWind({ x: 0, y: 10_000, z: 0 }, windOptions),
      ),
    },
    starOpacity: +input.starOpacity.toFixed(3),
    moonOpacity: +input.moonOpacity.toFixed(3),
    earthOpacity: +input.earthOpacity.toFixed(3),
    karmanLineM: environment.karmanLineM,
    moon: {
      physicalDistanceM: environment.moonDistanceM,
      renderShellDistanceM: 340,
    },
    meteorite: { ...input.meteorite, radiusM: 12 },
    testSite: {
      id: environment.testSite.id,
      footprintM: {
        width: environment.testSite.footprint.sizeM[0],
        depth: environment.testSite.footprint.sizeM[1],
      },
      districts: environment.testSite.districts.map(({ id, label }) => ({
        id,
        label,
      })),
      surfaceRegionCount: environment.testSite.surfaceRegions.length,
      heightFeatureCount: environment.testSite.heightFeatures.length,
      fluidRegionCount: environment.testSite.fluidRegions.length,
      clearVolumeCount: environment.testSite.clearVolumes.length,
      activeSurface: localSurface
        ? {
            materialKey: localSurface.materialKey,
            districtId: localSurface.districtId,
            featureIds: [...localSurface.featureIds],
          }
        : null,
      presentationLod: input.detailLod?.() || null,
    },
    features: {
      columns: 0,
      trees: testSiteVegetation.filter(({ kind }) => kind === "tree-stand")
        .length,
      ponds: environment.testSite.fluidRegions.length,
      hills: environment.testSite.heightFeatures.filter(
        (feature) => testSiteHeightFeatureExtrema(feature).maximumM > 0.5,
      ).length,
      mountainTerrain: {
        innerRadiusM: 9000,
        outerRadiusM: 23000,
        maximumElevationM: 4050,
      },
      cloudLayers: CLOUD_LAYERS.map((layer) => ({
        id: layer.id,
        baseM: layer.baseM,
        topM: layer.topM,
        clusters: layer.clusters,
      })),
      grassBlades: testSiteVegetation.filter(
        ({ kind }) => kind === "grass-field",
      ).length,
      collidableRocks: environment.testSite.staticFixtures.filter(
        ({ presentation }) => presentation.key === "rock",
      ).length,
      solidFixtures:
        environment.testSite.staticFixtures.filter(
          ({ collisionGeometry }) => collisionGeometry.kind !== "none",
        ).length +
        testSiteVegetation.filter(({ collidable }) => collidable).length,
    },
    ponds: environment.pondSpecs.map((pond) => ({
      id: pond.id,
      center: { x: pond.x, z: pond.z },
      radii: { x: pond.rx, z: pond.rz },
      deepestDepthM: pond.depth,
      waterSurfaceY: pond.waterY,
      collisionBasin: true,
    })),
  };
}
