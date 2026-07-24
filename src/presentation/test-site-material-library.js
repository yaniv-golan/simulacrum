import * as THREE from "three";

// At the tightest 1.8 m world repeat this is still 14 mm/texel, while keeping
// deterministic atlas synthesis comfortably inside the startup budget. The
// three maps carry material-scale detail; larger variation stays in world
// space in the shader and surface geometry rather than a higher-resolution
// startup texture.
const TILE_SIZE = 128;
const ATLAS_COLUMNS = 4;
const ATLAS_ROWS = 3;

const SURFACE_PROFILES = Object.freeze([
  {
    key: "short-grass",
    base: [28, 55, 25],
    accent: [86, 91, 42],
    roughness: 0.96,
    repeatM: 5.5,
    kind: "grass",
    seed: 87031,
  },
  {
    key: "dry-asphalt",
    base: [45, 51, 52],
    accent: [105, 111, 108],
    roughness: 0.88,
    repeatM: 3.2,
    kind: "asphalt",
    seed: 48131,
  },
  {
    key: "wet-asphalt",
    base: [31, 43, 44],
    accent: [93, 111, 112],
    roughness: 0.31,
    repeatM: 3.2,
    kind: "wet-asphalt",
    seed: 48131,
  },
  {
    key: "weathered-concrete",
    base: [124, 128, 119],
    accent: [183, 178, 158],
    roughness: 0.86,
    repeatM: 4.8,
    kind: "concrete",
    seed: 44031,
  },
  {
    key: "compacted-soil",
    base: [77, 61, 43],
    accent: [126, 101, 67],
    roughness: 0.94,
    repeatM: 4.2,
    kind: "soil",
    seed: 66103,
  },
  {
    key: "loose-gravel",
    base: [109, 106, 96],
    accent: [190, 181, 155],
    roughness: 0.98,
    repeatM: 2.3,
    kind: "gravel",
    seed: 31415,
  },
  {
    key: "dry-sand",
    base: [190, 157, 99],
    accent: [229, 207, 154],
    roughness: 0.97,
    repeatM: 3.8,
    kind: "sand",
    seed: 27183,
  },
  {
    key: "saturated-mud",
    base: [58, 50, 36],
    accent: [122, 101, 69],
    roughness: 0.55,
    repeatM: 4.4,
    kind: "mud",
    seed: 77213,
  },
  {
    key: "low-grip-polymer",
    base: [182, 202, 204],
    accent: [238, 244, 239],
    roughness: 0.24,
    repeatM: 2.8,
    kind: "polymer",
    seed: 16180,
  },
  {
    key: "weathered-stone",
    base: [102, 103, 96],
    accent: [166, 161, 145],
    roughness: 0.93,
    repeatM: 2.6,
    kind: "stone",
    seed: 51023,
  },
  {
    key: "wood-bark",
    base: [82, 53, 30],
    accent: [139, 99, 54],
    roughness: 0.96,
    repeatM: 1.8,
    kind: "bark",
    seed: 92041,
  },
  {
    key: "painted-steel",
    base: [61, 79, 80],
    accent: [132, 153, 148],
    roughness: 0.52,
    repeatM: 3.4,
    kind: "steel",
    seed: 73129,
  },
]);

const PROFILE_BY_KEY = new Map(
  SURFACE_PROFILES.map((profile, index) => [
    profile.key,
    { ...profile, index },
  ]),
);

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));
const smooth = (value) => value * value * (3 - 2 * value);

function hash2(x, y, seed) {
  let value = Math.imul(x + seed, 374761393) + Math.imul(y - seed, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicNoise(x, y, seed, cells) {
  const px = ((x % cells) + cells) % cells,
    py = ((y % cells) + cells) % cells,
    x0 = Math.floor(px),
    y0 = Math.floor(py),
    tx = smooth(px - x0),
    ty = smooth(py - y0),
    x1 = (x0 + 1) % cells,
    y1 = (y0 + 1) % cells,
    a = hash2(x0, y0, seed),
    b = hash2(x1, y0, seed),
    c = hash2(x0, y1, seed),
    d = hash2(x1, y1, seed),
    top = THREE.MathUtils.lerp(a, b, tx),
    bottom = THREE.MathUtils.lerp(c, d, tx);
  return THREE.MathUtils.lerp(top, bottom, ty);
}

function profileSample(profile, x, y) {
  const u = x / TILE_SIZE,
    v = y / TILE_SIZE,
    macro = periodicNoise(u * 8, v * 8, profile.seed, 8),
    detail = periodicNoise(u * 46, v * 46, profile.seed + 19, 46),
    fine = periodicNoise(u * 112, v * 112, profile.seed + 47, 112);
  let height = detail * 0.55 + fine * 0.22 + macro * 0.23,
    tint = (macro - 0.5) * 0.22 + (detail - 0.5) * 0.13,
    roughness = profile.roughness + (fine - 0.5) * 0.1,
    ao = 0.91 + macro * 0.09;

  if (profile.kind === "grass") {
    const blades = Math.max(0, Math.sin((u * 59 + v * 9) * Math.PI) - 0.62);
    height += blades * 0.24;
    tint += blades * 0.16;
  } else if (profile.kind === "asphalt" || profile.kind === "wet-asphalt") {
    const aggregate = fine > 0.73 ? (fine - 0.73) * 0.9 : 0;
    height = 0.42 + aggregate + detail * 0.2;
    tint += aggregate * 0.16;
    if (profile.kind === "wet-asphalt") {
      const wetPatch = smooth(
        periodicNoise(u * 5, v * 5, profile.seed + 73, 5),
      );
      roughness = 0.2 + wetPatch * 0.2;
      tint -= wetPatch * 0.12;
    }
  } else if (profile.kind === "concrete") {
    const pores = fine > 0.79 ? (fine - 0.79) * -1.5 : 0;
    height = 0.55 + detail * 0.16 + pores;
    tint += pores * 0.1;
  } else if (profile.kind === "soil") {
    const compression = Math.sin((u * 6.2 + v * 1.4) * Math.PI * 2) * 0.06;
    height += compression;
    tint += compression * 0.7;
  } else if (profile.kind === "gravel" || profile.kind === "stone") {
    const stones = Math.max(0, fine - 0.48) * 1.45;
    height = 0.26 + stones + detail * 0.18;
    tint += stones * 0.28;
    ao -= stones * 0.08;
  } else if (profile.kind === "sand") {
    const ripples = Math.sin(
      (u * 15 + Math.sin(v * Math.PI * 4)) * Math.PI * 2,
    );
    height = 0.5 + ripples * 0.12 + detail * 0.12;
    tint += ripples * 0.06;
  } else if (profile.kind === "mud") {
    const channels = Math.abs(Math.sin((u * 8 + v * 1.8) * Math.PI));
    height = 0.38 + detail * 0.2 - Math.max(0, 0.3 - channels) * 0.52;
    const sheen = periodicNoise(u * 4, v * 4, profile.seed + 91, 4);
    roughness = 0.34 + sheen * 0.34;
    tint -= sheen * 0.09;
  } else if (profile.kind === "polymer") {
    const hatch = Math.sin((u + v) * Math.PI * 42) * 0.5 + 0.5;
    height = 0.48 + hatch * 0.12;
    tint += hatch * 0.08;
  } else if (profile.kind === "bark") {
    const ridges = Math.abs(Math.sin((u * 10 + detail * 0.7) * Math.PI));
    height = 0.28 + ridges * 0.6 + macro * 0.12;
    tint += ridges * 0.12;
  } else if (profile.kind === "steel") {
    const wear = periodicNoise(u * 6, v * 6, profile.seed + 11, 6);
    height = 0.48 + fine * 0.08;
    tint += wear * 0.08;
  }

  const blend = THREE.MathUtils.clamp(0.44 + tint, 0.16, 0.78),
    color = profile.base.map((channel, index) =>
      clampByte(THREE.MathUtils.lerp(channel, profile.accent[index], blend)),
    );
  return {
    color,
    height: THREE.MathUtils.clamp(height, 0, 1),
    roughness: THREE.MathUtils.clamp(roughness, 0.08, 1),
    ao: THREE.MathUtils.clamp(ao, 0.68, 1),
  };
}

function createAtlasCanvases() {
  const width = TILE_SIZE * ATLAS_COLUMNS,
    height = TILE_SIZE * ATLAS_ROWS,
    colorCanvas = document.createElement("canvas"),
    normalCanvas = document.createElement("canvas"),
    packedCanvas = document.createElement("canvas");
  for (const canvas of [colorCanvas, normalCanvas, packedCanvas]) {
    canvas.width = width;
    canvas.height = height;
  }
  const colorContext = colorCanvas.getContext("2d"),
    normalContext = normalCanvas.getContext("2d"),
    packedContext = packedCanvas.getContext("2d"),
    colorImage = colorContext.createImageData(width, height),
    normalImage = normalContext.createImageData(width, height),
    packedImage = packedContext.createImageData(width, height);

  for (const profile of SURFACE_PROFILES) {
    const profileWithIndex = PROFILE_BY_KEY.get(profile.key),
      tileX = (profileWithIndex.index % ATLAS_COLUMNS) * TILE_SIZE,
      tileY = Math.floor(profileWithIndex.index / ATLAS_COLUMNS) * TILE_SIZE,
      samples = Array.from({ length: TILE_SIZE * TILE_SIZE }, () => null);
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++)
        samples[y * TILE_SIZE + x] = profileSample(profile, x, y);
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) {
        const sample = samples[y * TILE_SIZE + x],
          left = samples[y * TILE_SIZE + ((x - 1 + TILE_SIZE) % TILE_SIZE)],
          right = samples[y * TILE_SIZE + ((x + 1) % TILE_SIZE)],
          up = samples[((y - 1 + TILE_SIZE) % TILE_SIZE) * TILE_SIZE + x],
          down = samples[((y + 1) % TILE_SIZE) * TILE_SIZE + x],
          strength = profile.kind === "gravel" ? 4.2 : 2.6,
          normal = new THREE.Vector3(
            (left.height - right.height) * strength,
            (up.height - down.height) * strength,
            1,
          ).normalize(),
          index = ((tileY + y) * width + tileX + x) * 4;
        colorImage.data.set([...sample.color, 255], index);
        normalImage.data.set(
          [
            clampByte((normal.x * 0.5 + 0.5) * 255),
            clampByte((normal.y * 0.5 + 0.5) * 255),
            clampByte((normal.z * 0.5 + 0.5) * 255),
            255,
          ],
          index,
        );
        packedImage.data.set(
          [
            clampByte(sample.ao * 255),
            clampByte(sample.roughness * 255),
            clampByte(sample.height * 255),
            255,
          ],
          index,
        );
      }
  }
  colorContext.putImageData(colorImage, 0, 0);
  normalContext.putImageData(normalImage, 0, 0);
  packedContext.putImageData(packedImage, 0, 0);
  return { colorCanvas, normalCanvas, packedCanvas };
}

function atlasRect(index) {
  const column = index % ATLAS_COLUMNS,
    row = Math.floor(index / ATLAS_COLUMNS);
  return new THREE.Vector4(
    column / ATLAS_COLUMNS,
    1 - (row + 1) / ATLAS_ROWS,
    1 / ATLAS_COLUMNS,
    1 / ATLAS_ROWS,
  );
}

function installAtlasSampling(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec4 testSiteAtlasRect;
attribute float testSiteRepeatM;
attribute float testSiteSlope;
varying vec4 vTestSiteAtlasRect;
varying float vTestSiteRepeatM;
varying float vTestSiteSlope;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vTestSiteAtlasRect = testSiteAtlasRect;
vTestSiteRepeatM = testSiteRepeatM;
vTestSiteSlope = testSiteSlope;`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
varying vec4 vTestSiteAtlasRect;
varying float vTestSiteRepeatM;
varying float vTestSiteSlope;
vec2 testSiteAtlasUv(vec2 sourceUv) {
  vec2 localUv = fract(sourceUv / vTestSiteRepeatM);
  vec2 inset = vec2(0.012);
  return vTestSiteAtlasRect.xy + (inset + localUv * (1.0 - inset * 2.0)) * vTestSiteAtlasRect.zw;
}`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
vec4 sampledDiffuseColor = texture2D(map, testSiteAtlasUv(vMapUv));
float testSiteMacro = sin(vMapUv.x * 0.071 + sin(vMapUv.y * 0.027)) * 0.5 + 0.5;
sampledDiffuseColor.rgb *= 0.92 + testSiteMacro * 0.1;
float exposedSlope = smoothstep(0.055, 0.28, vTestSiteSlope);
sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * vec3(0.62, 0.52, 0.4), exposedSlope * 0.58);
diffuseColor *= sampledDiffuseColor;
#endif`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
vec4 texelRoughness = texture2D(roughnessMap, testSiteAtlasUv(vRoughnessMapUv));
roughnessFactor *= texelRoughness.g;
#endif`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#ifdef USE_NORMALMAP_OBJECTSPACE
normal = texture2D(normalMap, testSiteAtlasUv(vNormalMapUv)).xyz * 2.0 - 1.0;
#ifdef FLIP_SIDED
normal = -normal;
#endif
#ifdef DOUBLE_SIDED
normal = normal * faceDirection;
#endif
normal = normalize(normalMatrix * normal);
#elif defined(USE_NORMALMAP_TANGENTSPACE)
vec3 mapN = texture2D(normalMap, testSiteAtlasUv(vNormalMapUv)).xyz * 2.0 - 1.0;
mapN.xy *= normalScale;
normal = normalize(tbn * mapN);
#elif defined(USE_BUMPMAP)
normal = perturbNormalArb(-vViewPosition, normal, dHdxy_fwd(), faceDirection);
#endif`,
      )
      .replace(
        "#include <aomap_fragment>",
        `#ifdef USE_AOMAP
float ambientOcclusion = (texture2D(aoMap, testSiteAtlasUv(vAoMapUv)).r - 1.0) * aoMapIntensity + 1.0;
reflectedLight.indirectDiffuse *= ambientOcclusion;
#if defined(USE_CLEARCOAT)
clearcoatSpecularIndirect *= ambientOcclusion;
#endif
#if defined(USE_SHEEN)
sheenSpecularIndirect *= ambientOcclusion;
#endif
#if defined(USE_ENVMAP) && defined(STANDARD)
float dotNV = saturate(dot(geometryNormal, geometryViewDir));
reflectedLight.indirectSpecular *= computeSpecularOcclusion(dotNV, ambientOcclusion, material.roughness);
#endif
#endif`,
      );
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => "test-site-surface-atlas-v3";
}

/** Creates the bounded shared material resources for the authored test site. */
export function createTestSiteMaterialLibrary({ renderer }) {
  const { colorCanvas, normalCanvas, packedCanvas } = createAtlasCanvases(),
    colorAtlas = new THREE.CanvasTexture(colorCanvas),
    normalAtlas = new THREE.CanvasTexture(normalCanvas),
    packedAtlas = new THREE.CanvasTexture(packedCanvas),
    anisotropy = renderer.capabilities.getMaxAnisotropy();
  colorAtlas.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [colorAtlas, normalAtlas, packedAtlas]) {
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    // Atlas tiles repeat independently in shader space. Automatic mip levels
    // average adjacent tiles together and turn a distant single-material mesh
    // into broad blocks of unrelated surface colors. Sample the deterministic
    // base level instead; macro breakup is supplied separately by the atlas.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.anisotropy = anisotropy;
  }
  colorAtlas.name = "test-site-base-color-atlas";
  normalAtlas.name = "test-site-normal-atlas";
  packedAtlas.name = "test-site-ao-roughness-detail-atlas";

  const surfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: colorAtlas,
    normalMap: normalAtlas,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 1,
    roughnessMap: packedAtlas,
    aoMap: packedAtlas,
    aoMapIntensity: 0.55,
    metalness: 0,
  });
  surfaceMaterial.name = "test-site-shared-surface-material";
  installAtlasSampling(surfaceMaterial);

  const applyMaterialProfile = (geometry, key) => {
    const profile = PROFILE_BY_KEY.get(key);
    if (!profile)
      throw new RangeError(`Unknown test-site material profile ${key}`);
    const count = geometry.attributes.position.count,
      rect = atlasRect(profile.index),
      rectValues = new Float32Array(count * 4),
      repeatValues = new Float32Array(count),
      slopeValues = new Float32Array(count),
      normals = geometry.attributes.normal,
      terrainGeometry =
        geometry.userData.authority === "test-site-surface-field";
    for (let index = 0; index < count; index++) {
      rectValues.set(rect.toArray(), index * 4);
      repeatValues[index] = profile.repeatM;
      slopeValues[index] = terrainGeometry
        ? 1 - Math.abs(normals.getZ(index))
        : 0;
    }
    geometry.setAttribute(
      "testSiteAtlasRect",
      new THREE.BufferAttribute(rectValues, 4),
    );
    geometry.setAttribute(
      "testSiteRepeatM",
      new THREE.BufferAttribute(repeatValues, 1),
    );
    geometry.setAttribute(
      "testSiteSlope",
      new THREE.BufferAttribute(slopeValues, 1),
    );
    return geometry;
  };

  return Object.freeze({
    surfaceMaterial,
    applyMaterialProfile,
    textures: Object.freeze({ colorAtlas, normalAtlas, packedAtlas }),
    snapshot: () => ({
      strategy: "shared-atlas",
      atlasSizePx: [colorCanvas.width, colorCanvas.height],
      tileSizePx: TILE_SIZE,
      textureCount: 3,
      materialKeys: [...PROFILE_BY_KEY.keys()],
      shaderPrograms: 1,
    }),
    dispose() {
      surfaceMaterial.dispose();
      colorAtlas.dispose();
      normalAtlas.dispose();
      packedAtlas.dispose();
    },
  });
}
