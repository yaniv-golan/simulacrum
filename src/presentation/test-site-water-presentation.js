import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function worldPoint(shape, localX, localZ) {
  const cosine = Math.cos(shape.rotationRad),
    sine = Math.sin(shape.rotationRad);
  return {
    x: shape.centerM[0] + localX * cosine - localZ * sine,
    z: shape.centerM[1] + localX * sine + localZ * cosine,
  };
}

function localPolygonGeometry(shape, ringsM) {
  const [outer, ...holes] = ringsM,
    outline = new THREE.Shape();
  outer.forEach(([x, z], index) =>
    index ? outline.lineTo(x, -z) : outline.moveTo(x, -z),
  );
  outline.closePath();
  for (const ring of holes) {
    const hole = new THREE.Path();
    ring.forEach(([x, z], index) =>
      index ? hole.lineTo(x, -z) : hole.moveTo(x, -z),
    );
    hole.closePath();
    outline.holes.push(hole);
  }
  const geometry = new THREE.ShapeGeometry(outline);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    const point = worldPoint(
      shape,
      positions.getX(index),
      positions.getZ(index),
    );
    positions.setXYZ(index, point.x, 0, point.z);
  }
  positions.needsUpdate = true;
  return geometry;
}

function conformGeometry(geometry, heightAt) {
  const positions = geometry.attributes.position,
    uvs = [];
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index),
      z = positions.getZ(index);
    positions.setY(index, heightAt(x, z));
    uvs.push(x, z);
  }
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function polygonBoundaryGeometry(shape, widthM, heightAt) {
  const halfWidth = widthM / 2,
    pieces = [];
  for (const ring of shape.ringsM)
    for (let index = 0; index < ring.length; index++) {
      const start = ring[index],
        end = ring[(index + 1) % ring.length],
        dx = end[0] - start[0],
        dz = end[1] - start[1],
        length = Math.hypot(dx, dz),
        px = (-dz / length) * halfWidth,
        pz = (dx / length) * halfWidth;
      pieces.push(
        localPolygonGeometry(shape, [
          [
            [start[0] + px, start[1] + pz],
            [start[0] - px, start[1] - pz],
            [end[0] - px, end[1] - pz],
            [end[0] + px, end[1] + pz],
          ],
        ]),
      );
    }
  return conformGeometry(mergeGeometries(pieces, false), heightAt);
}

function waterNormalTexture() {
  const size = 256,
    canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d"),
    image = context.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const longX = Math.cos(x * 0.071 + y * 0.029) * 0.34,
        longY = Math.sin(y * 0.064 - x * 0.023) * 0.34,
        shortX = Math.cos(x * 0.19 - y * 0.041) * 0.2,
        shortY = Math.sin(y * 0.17 + x * 0.037) * 0.2,
        index = (y * size + x) * 4;
      image.data[index] = 128 + (longX + shortX) * 96;
      image.data[index + 1] = 128 + (longY + shortY) * 96;
      image.data[index + 2] = 224;
      image.data[index + 3] = 255;
    }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = "test-site-two-scale-water-normal";
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3.1, 2.55);
  return texture;
}

function radialGeometry({
  pond,
  terrainHeightAt,
  innerRadius = 0,
  outerRadius = 1,
  yOffset = 0.012,
  radialSegments = 8,
  angularSegments = 96,
}) {
  const positions = [],
    uvs = [],
    indices = [];
  for (let ring = 0; ring <= radialSegments; ring++) {
    const radius = THREE.MathUtils.lerp(
      innerRadius,
      outerRadius,
      ring / radialSegments,
    );
    for (let segment = 0; segment < angularSegments; segment++) {
      const angle = (segment / angularSegments) * Math.PI * 2,
        x = pond.x + Math.cos(angle) * pond.rx * radius,
        z = pond.z + Math.sin(angle) * pond.rz * radius;
      positions.push(x, terrainHeightAt(x, z) + yOffset, z);
      uvs.push(x, z);
    }
  }
  for (let ring = 0; ring < radialSegments; ring++)
    for (let segment = 0; segment < angularSegments; segment++) {
      const next = (segment + 1) % angularSegments,
        a = ring * angularSegments + segment,
        b = ring * angularSegments + next,
        c = (ring + 1) * angularSegments + segment,
        d = (ring + 1) * angularSegments + next;
      indices.push(a, b, c, b, d, c);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function waterMaterial(pond, normalMap) {
  const deep = THREE.MathUtils.clamp((pond.depth - 0.6) / 2.6, 0, 1),
    color = new THREE.Color(0x4b8b8b).lerp(new THREE.Color(0x153f4b), deep);
  return new THREE.MeshPhysicalMaterial({
    color,
    emissive: new THREE.Color(0x0b3137).multiplyScalar(0.42 + deep * 0.18),
    emissiveIntensity: 0.08,
    roughness: 0.19 + (1 - deep) * 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.68 + deep * 0.12,
    transmission: 0.1,
    ior: 1.333,
    thickness: 0.7 + pond.depth * 0.44,
    clearcoat: 0.82,
    clearcoatRoughness: 0.2,
    normalMap,
    normalScale: new THREE.Vector2(0.16, 0.16),
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/** Builds water and wet banks from the exact canonical fluid ellipses. */
export function createTestSiteWaterPresentation({
  parent,
  pondSpecs,
  terrainHeightAt,
  surfaceMaterial,
  applyMaterialProfile,
}) {
  const root = new THREE.Group(),
    nearDetails = new THREE.Group(),
    normalTexture = waterNormalTexture(),
    materials = [];
  root.name = "testSiteWaterPresentation";
  nearDetails.name = "testSiteWaterNearDetails";
  root.add(nearDetails);
  parent.add(root);

  for (const pond of pondSpecs) {
    if (pond.shape?.kind === "polygon") {
      const basinGeometry = conformGeometry(
        localPolygonGeometry(pond.shape, pond.shape.ringsM),
        (x, z) => terrainHeightAt(x, z) + 0.012,
      );
      applyMaterialProfile(basinGeometry, "saturated-mud");
      const basin = new THREE.Mesh(basinGeometry, surfaceMaterial);
      basin.name = `water-bed:${pond.id}`;
      basin.receiveShadow = true;
      root.add(basin);

      const wetBankGeometry = polygonBoundaryGeometry(
        pond.shape,
        2.4,
        (x, z) => terrainHeightAt(x, z) + 0.04,
      );
      applyMaterialProfile(wetBankGeometry, "saturated-mud");
      const wetBank = new THREE.Mesh(wetBankGeometry, surfaceMaterial);
      wetBank.name = `wet-bank:${pond.id}`;
      wetBank.receiveShadow = true;
      root.add(wetBank);

      const dampShoreGeometry = polygonBoundaryGeometry(
        pond.shape,
        4.2,
        (x, z) => terrainHeightAt(x, z) + 0.028,
      );
      applyMaterialProfile(dampShoreGeometry, "saturated-mud");
      const dampShore = new THREE.Mesh(dampShoreGeometry, surfaceMaterial);
      dampShore.name = `damp-shore:${pond.id}`;
      dampShore.receiveShadow = true;
      root.add(dampShore);

      const material = waterMaterial(pond, normalTexture),
        waterGeometry = conformGeometry(
          localPolygonGeometry(pond.shape, pond.shape.ringsM),
          () => pond.waterY,
        ),
        water = new THREE.Mesh(waterGeometry, material);
      materials.push(material);
      water.name = `water-surface:${pond.id}`;
      water.receiveShadow = true;
      water.renderOrder = 2;
      root.add(water);

      const glint = new THREE.Mesh(
        polygonBoundaryGeometry(pond.shape, 0.9, () => pond.waterY + 0.01),
        new THREE.MeshBasicMaterial({
          color: pond.depth > 1 ? 0xa3d0c7 : 0xd5ddd0,
          transparent: true,
          opacity: pond.depth > 1 ? 0.08 : 0.14,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      glint.name = `water-edge-glint:${pond.id}`;
      glint.renderOrder = 3;
      nearDetails.add(glint);
      continue;
    }
    const basinGeometry = radialGeometry({
      pond,
      terrainHeightAt,
      radialSegments: 12,
    });
    applyMaterialProfile(basinGeometry, "saturated-mud");
    const basin = new THREE.Mesh(basinGeometry, surfaceMaterial);
    basin.name = `water-bed:${pond.id}`;
    basin.receiveShadow = true;
    root.add(basin);

    const wetBankGeometry = radialGeometry({
      pond,
      terrainHeightAt,
      innerRadius: 0.965,
      outerRadius: 1.12,
      yOffset: 0.04,
      radialSegments: 3,
    });
    applyMaterialProfile(wetBankGeometry, "saturated-mud");
    const wetBank = new THREE.Mesh(wetBankGeometry, surfaceMaterial);
    wetBank.name = `wet-bank:${pond.id}`;
    wetBank.receiveShadow = true;
    root.add(wetBank);

    const dampShoreGeometry = radialGeometry({
      pond,
      terrainHeightAt,
      innerRadius: 1.01,
      outerRadius: 1.16,
      yOffset: 0.028,
      radialSegments: 2,
    });
    applyMaterialProfile(dampShoreGeometry, "saturated-mud");
    const dampShore = new THREE.Mesh(dampShoreGeometry, surfaceMaterial);
    dampShore.name = `damp-shore:${pond.id}`;
    dampShore.receiveShadow = true;
    root.add(dampShore);

    const material = waterMaterial(pond, normalTexture),
      water = new THREE.Mesh(new THREE.CircleGeometry(1, 96), material);
    materials.push(material);
    water.name = `water-surface:${pond.id}`;
    water.position.set(pond.x, pond.waterY, pond.z);
    water.rotation.x = -Math.PI / 2;
    water.scale.set(pond.rx * 0.965, pond.rz * 0.965, 1);
    water.receiveShadow = true;
    water.renderOrder = 2;
    root.add(water);

    const glint = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 0.96, 96),
      new THREE.MeshBasicMaterial({
        color: pond.depth > 1 ? 0xa3d0c7 : 0xd5ddd0,
        transparent: true,
        opacity: pond.depth > 1 ? 0.08 : 0.14,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    glint.name = `water-edge-glint:${pond.id}`;
    glint.position.set(pond.x, pond.waterY + 0.01, pond.z);
    glint.rotation.x = -Math.PI / 2;
    glint.scale.set(pond.rx, pond.rz, 1);
    glint.renderOrder = 3;
    nearDetails.add(glint);
  }

  let detailLevel = "near",
    performanceMode = false;
  const applyDetail = () => {
    nearDetails.visible = !performanceMode && detailLevel !== "far";
  };
  return Object.freeze({
    root,
    normalTexture,
    updateDetailLod(distanceM) {
      detailLevel = distanceM > 140 ? "far" : distanceM > 45 ? "mid" : "near";
      applyDetail();
    },
    setPerformanceMode(enabled) {
      performanceMode = Boolean(enabled);
      applyDetail();
    },
    snapshot: () => ({
      level: performanceMode ? "performance" : detailLevel,
      poolsVisible: pondSpecs.length,
      wetBanksVisible: true,
      edgeGlintsVisible: nearDetails.visible,
    }),
    dispose() {
      normalTexture.dispose();
      for (const material of materials) material.dispose();
    },
  });
}
