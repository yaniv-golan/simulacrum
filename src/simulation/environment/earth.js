import { feature as topojsonFeature } from "topojson-client";
import landTopology from "world-atlas/land-110m.json" with { type: "json" };

export const EARTH_RADIUS_M = 6_371_000;
export const BUILD_SITE_LAT_DEG = 32.1953977;
export const BUILD_SITE_LON_DEG = 34.9007962;
export const KARMAN_LINE_M = 100_000;
export const MOON_DISTANCE_M = 384_400_000;
export const FIELD_SURFACE_Y = -0.65;
export const EARTH_SEA_LEVEL_Y = -24;
export const EARTH_CHUNK_SIZE_M = 512;
export const WATER_DENSITY = 997;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, amount) => a + (b - a) * amount;
const smoothstep = (min, max, value) => {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
};

const landFeature = topojsonFeature(landTopology, landTopology.objects.land),
  landGeometry = landFeature.geometry || landFeature.features?.[0]?.geometry;

export const LAND_POLYGONS =
  landGeometry.type === "MultiPolygon"
    ? landGeometry.coordinates
    : [landGeometry.coordinates];

const LAND_BOUNDS = LAND_POLYGONS.map((polygon) => {
  const points = polygon.flat();
  return {
    minLon: Math.min(...points.map((point) => point[0])),
    maxLon: Math.max(...points.map((point) => point[0])),
    minLat: Math.min(...points.map((point) => point[1])),
    maxLat: Math.max(...points.map((point) => point[1])),
  };
});

export const POND_SPECS = [
  {
    id: "main",
    x: 12,
    z: -42,
    rx: 25.5,
    rz: 16.8,
    depth: 3.2,
    waterY: FIELD_SURFACE_Y + 0.035,
  },
  {
    id: "woodland",
    x: -18,
    z: -39,
    rx: 6.4,
    rz: 4.4,
    depth: 1.45,
    waterY: FIELD_SURFACE_Y + 0.025,
  },
];

function pointInRing(longitude, latitude, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1],
      xj = ring[j][0],
      yj = ring[j][1],
      intersects =
        yi > latitude !== yj > latitude &&
        longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function coordinateIsLand(longitude, latitude) {
  for (let index = 0; index < LAND_POLYGONS.length; index++) {
    const bounds = LAND_BOUNDS[index];
    if (
      longitude < bounds.minLon ||
      longitude > bounds.maxLon ||
      latitude < bounds.minLat ||
      latitude > bounds.maxLat
    )
      continue;
    const polygon = LAND_POLYGONS[index];
    if (!pointInRing(longitude, latitude, polygon[0])) continue;
    if (polygon.slice(1).some((ring) => pointInRing(longitude, latitude, ring)))
      continue;
    return true;
  }
  return false;
}

export function globalToGeodetic(eastM, northM) {
  const originLatitude = (BUILD_SITE_LAT_DEG * Math.PI) / 180,
    originLongitude = (BUILD_SITE_LON_DEG * Math.PI) / 180,
    distance = Math.hypot(eastM, northM),
    angularDistance = distance / EARTH_RADIUS_M,
    bearing = Math.atan2(eastM, northM),
    latitude = Math.asin(
      Math.sin(originLatitude) * Math.cos(angularDistance) +
        Math.cos(originLatitude) *
          Math.sin(angularDistance) *
          Math.cos(bearing),
    ),
    longitude =
      originLongitude +
      Math.atan2(
        Math.sin(bearing) *
          Math.sin(angularDistance) *
          Math.cos(originLatitude),
        Math.cos(angularDistance) -
          Math.sin(originLatitude) * Math.sin(latitude),
      );
  return {
    latitude: (latitude * 180) / Math.PI,
    longitude:
      (((((longitude * 180) / Math.PI + 180) % 360) + 360) % 360) - 180,
  };
}

export function coordinateHash(x, z, salt = 0) {
  const mix = (input) => {
      let value = input | 0;
      value = Math.imul(value ^ (value >>> 16), 2146121005);
      value = Math.imul(value ^ (value >>> 15), 2221713035);
      return (value ^ (value >>> 16)) >>> 0;
    },
    east = mix((x | 0) ^ 0x51ed270b),
    north = mix((z | 0) ^ 0x68bc21eb),
    rotatedNorth = ((north << 16) | (north >>> 16)) >>> 0,
    value = mix(east ^ rotatedNorth ^ mix((salt | 0) ^ 0x02e5be93));
  return value / 4294967295;
}

export function globalValueNoise(x, z, scale, salt = 0) {
  const gx = x / scale,
    gz = z / scale,
    ix = Math.floor(gx),
    iz = Math.floor(gz),
    fx = gx - ix,
    fz = gz - iz,
    sx = fx * fx * (3 - 2 * fx),
    sz = fz * fz * (3 - 2 * fz),
    a = coordinateHash(ix, iz, salt),
    b = coordinateHash(ix + 1, iz, salt),
    c = coordinateHash(ix, iz + 1, salt),
    d = coordinateHash(ix + 1, iz + 1, salt);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}

export function globalFractalNoise(x, z, baseScale, salt = 0) {
  let value = 0,
    amplitude = 0.55,
    normalization = 0;
  for (let octave = 0; octave < 5; octave++) {
    value +=
      globalValueNoise(x, z, baseScale / 2 ** octave, salt + octave * 17) *
      amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
  }
  return value / normalization;
}

export function generatedPoolAt(eastM, northM) {
  const chunkX = Math.floor(eastM / EARTH_CHUNK_SIZE_M),
    chunkZ = Math.floor(northM / EARTH_CHUNK_SIZE_M);
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      const x = chunkX + dx,
        z = chunkZ + dz;
      if (coordinateHash(x, z, 3001) > 0.16) continue;
      const centerEast =
          (x + 0.18 + coordinateHash(x, z, 3002) * 0.64) * EARTH_CHUNK_SIZE_M,
        centerNorth =
          (z + 0.18 + coordinateHash(x, z, 3003) * 0.64) * EARTH_CHUNK_SIZE_M,
        radius = 18 + coordinateHash(x, z, 3004) * 48,
        normalizedRadius =
          Math.hypot(eastM - centerEast, northM - centerNorth) / radius;
      if (normalizedRadius < 1)
        return {
          centerEast,
          centerNorth,
          radius,
          normalizedRadius,
          depth: 1.2 + coordinateHash(x, z, 3005) * 3.6,
        };
    }
  return null;
}

export function earthSurfaceSample(eastM, northM) {
  const geodetic = globalToGeodetic(eastM, northM),
    land = coordinateIsLand(geodetic.longitude, geodetic.latitude),
    continental = globalFractalNoise(eastM, northM, 18000, 301),
    hills = globalFractalNoise(eastM, northM, 2400, 701),
    detail = globalFractalNoise(eastM, northM, 260, 1103),
    mountain = Math.pow(smoothstep(0.61, 0.91, continental), 1.7),
    reserveBlend = smoothstep(220, 850, Math.hypot(eastM, northM)),
    riverField = Math.abs(globalValueNoise(eastM, northM, 6500, 1709) - 0.5),
    river = land && reserveBlend > 0.9 && riverField < 0.012,
    pool = land && reserveBlend > 0.9 ? generatedPoolAt(eastM, northM) : null,
    rawElevation = land
      ? FIELD_SURFACE_Y +
        (hills - 0.5) * 18 +
        (detail - 0.5) * 2.8 +
        mountain * 1250
      : EARTH_SEA_LEVEL_Y - 22 - continental * 105,
    inlandWaterY = river
      ? rawElevation - 0.15
      : pool
        ? FIELD_SURFACE_Y +
          (globalFractalNoise(pool.centerEast, pool.centerNorth, 2400, 701) -
            0.5) *
            18
        : null,
    shoreBlend = pool
      ? pool.normalizedRadius ** 2 * (3 - 2 * pool.normalizedRadius)
      : 1,
    waterCutElevation = river
      ? rawElevation - 2.2
      : pool
        ? inlandWaterY - pool.depth * (1 - shoreBlend)
        : rawElevation,
    elevation = lerp(FIELD_SURFACE_Y, waterCutElevation, reserveBlend),
    aridity = globalValueNoise(eastM, northM, 42000, 2101),
    absoluteLatitude = Math.abs(geodetic.latitude),
    biome = !land
      ? "ocean"
      : river || pool
        ? "river"
        : absoluteLatitude > 67
          ? "tundra"
          : aridity > 0.7
            ? "dryland"
            : mountain > 0.55
              ? "mountain"
              : "temperate";
  return {
    ...geodetic,
    land,
    river,
    pool: !!pool,
    water: !land || river || !!pool,
    waterY: land ? inlandWaterY : EARTH_SEA_LEVEL_Y,
    elevation,
    biome,
    mountain,
    aridity,
  };
}

export function createEarthEnvironmentModel({
  originEastM = 0,
  originNorthM = 0,
} = {}) {
  const localToGlobalSurface = (x, z) => ({
    eastM: originEastM + x,
    northM: originNorthM + z,
  });

  const pondAt = (x, z, margin = 1) => {
    let nearest = null;
    for (const pond of POND_SPECS) {
      const nx = (x - pond.x) / pond.rx,
        nz = (z - pond.z) / pond.rz,
        normalizedRadius = Math.hypot(nx, nz);
      if (
        normalizedRadius <= margin &&
        (!nearest || normalizedRadius < nearest.normalizedRadius)
      )
        nearest = { ...pond, normalizedRadius };
    }
    if (!nearest && (Math.abs(x) > 80 || Math.abs(z) > 80)) {
      const global = localToGlobalSurface(x, z),
        sample = earthSurfaceSample(global.eastM, global.northM);
      if (sample.water)
        return {
          id: sample.river ? "global-river" : "global-ocean",
          x,
          z,
          rx: Infinity,
          rz: Infinity,
          depth: Math.max(0, sample.waterY - sample.elevation),
          waterY: sample.waterY,
          normalizedRadius: 0,
          global: true,
        };
    }
    return nearest;
  };

  const terrainHeightAt = (x, z) => {
    let height = FIELD_SURFACE_Y;
    for (const pond of POND_SPECS) {
      const radius = Math.hypot((x - pond.x) / pond.rx, (z - pond.z) / pond.rz);
      if (radius >= 1) continue;
      const t = clamp(radius, 0, 1),
        shoreBlend = t * t * (3 - 2 * t);
      height = Math.min(
        height,
        FIELD_SURFACE_Y - pond.depth * (1 - shoreBlend),
      );
    }
    return height;
  };

  const surfaceHeightAt = (x, z) => {
    if (Math.abs(x) <= 22 && Math.abs(z) <= 22) return 0;
    if (Math.abs(x) <= 80 && Math.abs(z) <= 80) return terrainHeightAt(x, z);
    const global = localToGlobalSurface(x, z);
    return earthSurfaceSample(global.eastM, global.northM).elevation;
  };

  return {
    localToGlobalSurface,
    pondAt,
    terrainHeightAt,
    surfaceHeightAt,
  };
}
