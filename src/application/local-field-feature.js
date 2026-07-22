import * as THREE from "three";
import * as CANNON from "cannon-es";
import { mesh } from "../presentation/mesh-primitives.js";

/** Composes the authored field's visual surface and matching static colliders. */
export function createLocalFieldFeature({
  scene,
  world,
  renderer,
  groundMaterial,
  terrainHeightAt,
  pondAt,
  pondSpecs,
  fieldSurfaceY,
}) {
  let waterNormalTextureRef, surfaceMesh;
  const environment = new THREE.Group();
  environment.name = "fieldEnvironment";
  scene.add(environment);
  function terrainTexture(base, flecks, seedValue, streaks = false) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    context.fillStyle = base;
    context.fillRect(0, 0, 256, 256);
    let textureSeed = seedValue;
    const textureRandom = () => {
      textureSeed = (textureSeed * 1664525 + 1013904223) >>> 0;
      return textureSeed / 4294967296;
    };
    for (let i = 0; i < 1800; i++) {
      context.globalAlpha = 0.08 + textureRandom() * 0.25;
      context.fillStyle = flecks[Math.floor(textureRandom() * flecks.length)];
      const x = textureRandom() * 256,
        y = textureRandom() * 256,
        width = 0.5 + textureRandom() * (streaks ? 7 : 3),
        height = 0.5 + textureRandom() * (streaks ? 1.8 : 3);
      context.beginPath();
      context.ellipse(
        x,
        y,
        width,
        height,
        textureRandom() * Math.PI,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(24, 24);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
  }
  const grassTexture = terrainTexture(
      "#526b3e",
      ["#78915a", "#344d2f", "#9a8855", "#c0ad76"],
      87031,
      true,
    ),
    meadowTexture = terrainTexture(
      "#66834a",
      ["#93a865", "#3f6738", "#b6a661"],
      92041,
      true,
    ),
    soilTexture = terrainTexture(
      "#715238",
      ["#9c7650", "#443123", "#b18a62", "#5c432d"],
      66103,
    ),
    wetSoilTexture = terrainTexture(
      "#3d3a2d",
      ["#665844", "#24271f", "#78694d"],
      77213,
    ),
    waterNormalCanvas = document.createElement("canvas");
  waterNormalCanvas.width = waterNormalCanvas.height = 256;
  const waterNormalContext = waterNormalCanvas.getContext("2d"),
    waterNormalImage = waterNormalContext.createImageData(256, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const waveX =
          Math.cos(x * 0.17 + y * 0.035) * 0.42 +
          Math.cos(x * 0.061 - y * 0.13) * 0.25,
        waveY =
          Math.sin(y * 0.145 + x * 0.028) * 0.42 +
          Math.sin(y * 0.052 - x * 0.11) * 0.25,
        index = (y * 256 + x) * 4;
      waterNormalImage.data[index] = 128 + waveX * 95;
      waterNormalImage.data[index + 1] = 128 + waveY * 95;
      waterNormalImage.data[index + 2] = 224;
      waterNormalImage.data[index + 3] = 255;
    }
  waterNormalContext.putImageData(waterNormalImage, 0, 0);
  const waterNormalTexture = new THREE.CanvasTexture(waterNormalCanvas);
  waterNormalTexture.wrapS = waterNormalTexture.wrapT = THREE.RepeatWrapping;
  waterNormalTexture.repeat.set(3.1, 2.55);
  waterNormalTextureRef = waterNormalTexture;
  const grassMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: grassTexture,
      roughness: 0.96,
      metalness: 0,
    }),
    meadowMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: meadowTexture,
      roughness: 1,
    }),
    soilMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: soilTexture,
      roughness: 1,
    }),
    wetSoilMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: wetSoilTexture,
      roughness: 0.82,
    }),
    barkMaterial = new THREE.MeshStandardMaterial({
      color: 0x5f4027,
      roughness: 1,
    }),
    leafMaterials = [0x315b35, 0x3f703e, 0x527d43].map(
      (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.92 }),
    ),
    concreteMaterial = new THREE.MeshStandardMaterial({
      color: 0x6e7470,
      roughness: 0.88,
      metalness: 0.08,
    }),
    columnMaterial = new THREE.MeshStandardMaterial({
      color: 0x43565a,
      roughness: 0.52,
      metalness: 0.42,
    }),
    waterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x216877,
      emissive: 0x082b35,
      emissiveIntensity: 0.11,
      roughness: 0.13,
      metalness: 0,
      transparent: true,
      opacity: 0.64,
      transmission: 0.26,
      ior: 1.333,
      thickness: 1.8,
      clearcoat: 1,
      clearcoatRoughness: 0.16,
      normalMap: waterNormalTexture,
      normalScale: new THREE.Vector2(0.2, 0.2),
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  const fieldGeometry = new THREE.PlaneGeometry(160, 160, 128, 128),
    fieldPositions = fieldGeometry.attributes.position;
  for (let i = 0; i < fieldPositions.count; i++) {
    const x = fieldPositions.getX(i),
      worldZ = -fieldPositions.getY(i);
    fieldPositions.setZ(i, terrainHeightAt(x, worldZ) - fieldSurfaceY);
  }
  fieldPositions.needsUpdate = true;
  fieldGeometry.computeVertexNormals();
  const field = mesh(
    fieldGeometry,
    grassMaterial,
    [0, fieldSurfaceY, 0],
    [-Math.PI / 2, 0, 0],
    environment,
  );
  field.castShadow = false;
  field.receiveShadow = true;
  surfaceMesh = field;
  const performanceFieldGeometry = new THREE.PlaneGeometry(160, 160, 16, 16),
    performancePositions = performanceFieldGeometry.attributes.position;
  for (let index = 0; index < performancePositions.count; index++) {
    const x = performancePositions.getX(index),
      worldZ = -performancePositions.getY(index);
    performancePositions.setZ(
      index,
      terrainHeightAt(x, worldZ) - fieldSurfaceY,
    );
  }
  performancePositions.needsUpdate = true;
  performanceFieldGeometry.computeVertexNormals();
  const performanceField = mesh(
    performanceFieldGeometry,
    grassMaterial,
    [0, fieldSurfaceY, 0],
    [-Math.PI / 2, 0, 0],
    environment,
  );
  performanceField.name = "performanceFieldSurface";
  performanceField.castShadow = false;
  performanceField.receiveShadow = true;
  performanceField.visible = false;
  function groundPatch(x, z, radiusX, radiusZ, material, y = 0.008) {
    const patch = mesh(
      new THREE.CircleGeometry(1, 64),
      material,
      [x, fieldSurfaceY + y, z],
      [-Math.PI / 2, 0, 0],
      environment,
    );
    patch.scale.set(radiusX, radiusZ, 1);
    patch.castShadow = false;
    return patch;
  }
  function basinOverlay(pond) {
    const radialSegments = 14,
      angularSegments = 72,
      vertices = [],
      uvs = [],
      indices = [];
    for (let ring = 0; ring <= radialSegments; ring++) {
      const radius = ring / radialSegments;
      for (let segment = 0; segment < angularSegments; segment++) {
        const angle = (segment / angularSegments) * Math.PI * 2,
          x = pond.x + Math.cos(angle) * pond.rx * radius,
          z = pond.z + Math.sin(angle) * pond.rz * radius;
        vertices.push(x, terrainHeightAt(x, z) + 0.012, z);
        uvs.push(
          (Math.cos(angle) * radius + 1) / 2,
          (Math.sin(angle) * radius + 1) / 2,
        );
      }
    }
    for (let ring = 0; ring < radialSegments; ring++)
      for (let segment = 0; segment < angularSegments; segment++) {
        const next = (segment + 1) % angularSegments,
          a = ring * angularSegments + segment,
          b = ring * angularSegments + next,
          c = (ring + 1) * angularSegments + segment,
          d = (ring + 1) * angularSegments + next;
        indices.push(a, c, b, b, c, d);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const bed = mesh(geometry, wetSoilMaterial, [], [], environment);
    bed.castShadow = false;
    return bed;
  }
  // Distinct nearby biomes: dry service ground, meadow, and two real basins.
  groundPatch(-35, -31, 14, 10, soilMaterial);
  groundPatch(-2, -50, 13, 8, meadowMaterial);
  for (const pond of pondSpecs) {
    basinOverlay(pond);
    const water = mesh(
      new THREE.CircleGeometry(1, 96),
      waterMaterial.clone(),
      [pond.x, pond.waterY, pond.z],
      [-Math.PI / 2, 0, 0],
      environment,
    );
    water.scale.set(pond.rx * 0.965, pond.rz * 0.965, 1);
    water.castShadow = false;
    water.receiveShadow = true;
    const shorePoints = [];
    for (let i = 0; i < 128; i++) {
      const angle = (i / 128) * Math.PI * 2;
      shorePoints.push(
        new THREE.Vector3(
          pond.x + Math.cos(angle) * pond.rx * 0.972,
          pond.waterY + 0.012,
          pond.z + Math.sin(angle) * pond.rz * 0.972,
        ),
      );
    }
    const shore = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(shorePoints),
      new THREE.LineBasicMaterial({
        color: 0xb6d3ba,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
      }),
    );
    environment.add(shore);
  }

  // Dense vegetation and landmarks can be suppressed as a presentation-only
  // LOD when a very large assembly needs the render budget. Terrain, soils,
  // water, and every physics collider remain authoritative and visible.
  const detailEnvironment = new THREE.Group();
  detailEnvironment.name = "fieldDetailEnvironment";
  environment.add(detailEnvironment);

  // Low terrain forms break up the horizon while keeping the workshop clear.
  for (const [x, z, sx, sy, sz] of [
    [-50, -42, 13, 4.2, 10],
    [-40, 39, 10, 3.2, 14],
    [45, 35, 14, 4.8, 11],
    [55, -25, 11, 3.5, 9],
    [8, 58, 18, 4.5, 10],
  ]) {
    const hill = mesh(
      new THREE.SphereGeometry(1, 32, 16),
      meadowMaterial,
      [x, fieldSurfaceY - sy * 0.62, z],
      [],
      detailEnvironment,
    );
    hill.scale.set(sx, sy, sz);
  }

  let seed = 19790317;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  function addTree(x, z, scale = 1) {
    const tree = new THREE.Group();
    const groundY = terrainHeightAt(x, z);
    tree.position.set(x, groundY, z);
    tree.rotation.y = random() * Math.PI * 2;
    detailEnvironment.add(tree);
    mesh(
      new THREE.CylinderGeometry(0.18 * scale, 0.28 * scale, 2.8 * scale, 9),
      barkMaterial,
      [0, 1.4 * scale, 0],
      [],
      tree,
    );
    const trunkBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: groundMaterial,
      shape: new CANNON.Cylinder(0.18 * scale, 0.28 * scale, 2.8 * scale, 9),
      position: new CANNON.Vec3(x, groundY + 1.4 * scale, z),
    });
    Object.assign(trunkBody, {
      userData: {
        externalBodyId: `environment:tree:${x}:${z}`,
        surface: "tree trunk",
        materialKey: "wood-bark",
      },
    });
    world.addBody(trunkBody);
    for (const [angle, height, length] of [
      [0.35, 2.15, 1.25],
      [2.5, 2.45, 1.05],
      [4.4, 2.7, 0.92],
    ]) {
      const branch = mesh(
        new THREE.CylinderGeometry(
          0.07 * scale,
          0.12 * scale,
          length * scale,
          7,
        ),
        barkMaterial,
        [
          Math.cos(angle) * length * scale * 0.3,
          height * scale,
          Math.sin(angle) * length * scale * 0.3,
        ],
        [Math.sin(angle) * 0.75, 0, Math.cos(angle) * 0.75],
        tree,
      );
      branch.castShadow = true;
    }
    for (const [ox, oy, oz, size, materialIndex] of [
      [0, 3.25, 0, 1.35, 0],
      [-0.65, 2.85, 0.15, 0.9, 1],
      [0.58, 3.0, -0.2, 1.02, 2],
      [0.1, 3.7, 0.25, 0.82, 1],
      [-0.22, 3.42, -0.62, 0.68, 2],
      [0.72, 3.38, 0.46, 0.62, 0],
    ]) {
      const crown = mesh(
        new THREE.IcosahedronGeometry(size * scale, 2),
        leafMaterials[materialIndex],
        [ox * scale, oy * scale, oz * scale],
        [random() * 0.25, random() * Math.PI, random() * 0.2],
        tree,
      );
      crown.scale.set(
        0.8 + random() * 0.3,
        0.78 + random() * 0.42,
        0.8 + random() * 0.32,
      );
    }
  }
  for (const [cx, cz, count, spreadX, spreadZ] of [
    [-47, -25, 15, 13, 22],
    [-28, -53, 10, 20, 10],
    [51, -29, 8, 9, 16],
  ]) {
    let planted = 0,
      attempts = 0;
    while (planted < count && attempts++ < count * 20) {
      const x = cx + (random() - 0.5) * spreadX,
        z = cz + (random() - 0.5) * spreadZ;
      if (pondAt(x, z, 1.12) || (Math.abs(x) < 24 && Math.abs(z) < 24))
        continue;
      addTree(x, z, 0.75 + random() * 0.55);
      planted++;
    }
  }

  // Crossed tapered blades catch light from multiple angles and vary in both
  // species color and height, without carpeting water or engineered surfaces.
  const bladeGeometry = new THREE.BufferGeometry();
  bladeGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -0.055, 0, 0, 0.055, 0, 0, 0.012, 0.48, 0, 0, 0, -0.055, 0, 0, 0.055, 0,
        0.43, 0.012, -0.04, 0, -0.04, 0.04, 0, 0.04, 0, 0.36, 0,
      ],
      3,
    ),
  );
  bladeGeometry.computeVertexNormals();
  const grassBladeCount = 2200;
  const blades = new THREE.InstancedMesh(
      bladeGeometry,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
      grassBladeCount,
    ),
    dummy = new THREE.Object3D(),
    grassColors = [0x6e8b45, 0x8d9d52, 0x526f3a, 0x9a8b4b].map(
      (color) => new THREE.Color(color),
    );
  let grassPlaced = 0,
    grassAttempts = 0;
  while (
    grassPlaced < grassBladeCount &&
    grassAttempts++ < grassBladeCount * 20
  ) {
    const x = -66 + random() * 132,
      z = -66 + random() * 132;
    if ((Math.abs(x) < 25 && Math.abs(z) < 25) || pondAt(x, z, 1.06)) continue;
    const dryPatch = Math.hypot((x + 35) / 14, (z + 31) / 10) < 1;
    if (dryPatch || random() < 0.37) continue;
    const s = 0.55 + random() * 1.15;
    dummy.position.set(x, terrainHeightAt(x, z) + 0.012, z);
    dummy.rotation.set(0, random() * Math.PI, (random() - 0.5) * 0.12);
    dummy.scale.set(0.72 + random() * 0.55, s, 0.72 + random() * 0.55);
    dummy.updateMatrix();
    blades.setMatrixAt(grassPlaced, dummy.matrix);
    blades.setColorAt(
      grassPlaced,
      grassColors[Math.floor(random() * grassColors.length)],
    );
    grassPlaced++;
  }
  blades.instanceMatrix.needsUpdate = true;
  if (blades.instanceColor) blades.instanceColor.needsUpdate = true;
  blades.receiveShadow = true;
  detailEnvironment.add(blades);

  // Twelve utility columns sit on visible concrete footings outside the slab.
  const columnPositions = [
    [-26, -18],
    [-26, 0],
    [-26, 18],
    [26, -18],
    [26, 0],
    [26, 18],
    [-18, -26],
    [8, -27],
    [18, -26],
    [-18, 26],
    [0, 26],
    [18, 26],
  ];
  for (const [x, z] of columnPositions) {
    const height = 4.6 + random() * 2.1;
    mesh(
      new THREE.CylinderGeometry(0.72, 0.88, 0.22, 12),
      concreteMaterial,
      [x, fieldSurfaceY + 0.11, z],
      [],
      detailEnvironment,
    );
    mesh(
      new THREE.CylinderGeometry(0.3, 0.48, height, 10),
      columnMaterial,
      [x, fieldSurfaceY + 0.22 + height / 2, z],
      [],
      detailEnvironment,
    );
    const columnBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: groundMaterial,
      shape: new CANNON.Cylinder(0.3, 0.48, height, 10),
      position: new CANNON.Vec3(x, fieldSurfaceY + 0.22 + height / 2, z),
    });
    Object.assign(columnBody, {
      userData: {
        externalBodyId: `environment:utility-column:${x}:${z}`,
        surface: "weathered concrete column",
        materialKey: "weathered-concrete",
      },
    });
    world.addBody(columnBody);
  }

  // A few rocks help the soil and pond banks read as actual terrain.
  for (let i = 0; i < 38; i++) {
    const nearPond = i < 16,
      angle = random() * Math.PI * 2,
      bankRadius = 1.03 + random() * 0.16,
      x = nearPond
        ? pondSpecs[0].x + Math.cos(angle) * pondSpecs[0].rx * bankRadius
        : -35 + (random() - 0.5) * 23,
      z = nearPond
        ? pondSpecs[0].z + Math.sin(angle) * pondSpecs[0].rz * bankRadius
        : -31 + (random() - 0.5) * 18,
      radius = 0.22 + random() * 0.34,
      rock = mesh(
        new THREE.DodecahedronGeometry(radius, 0),
        concreteMaterial,
        [x, terrainHeightAt(x, z) + radius * 0.42, z],
        [random(), random(), random()],
        detailEnvironment,
      );
    rock.scale.y = 0.55 + random() * 0.45;
    const rockBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: groundMaterial,
      shape: new CANNON.Sphere(radius * 0.78),
      position: new CANNON.Vec3(x, terrainHeightAt(x, z) + radius * 0.42, z),
    });
    Object.assign(rockBody, {
      userData: {
        externalBodyId: `environment:rock:${i}`,
        surface: "weathered stone",
        materialKey: "weathered-stone",
      },
    });
    world.addBody(rockBody);
  }
  return {
    root: environment,
    detailRoot: detailEnvironment,
    surfaceMesh,
    waterNormalTexture: waterNormalTextureRef,
    setPerformanceMode(enabled) {
      field.visible = !enabled;
      performanceField.visible = Boolean(enabled);
      detailEnvironment.visible = !enabled;
    },
  };
}
