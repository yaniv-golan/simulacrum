import * as THREE from "three";
import { mesh } from "./mesh-primitives.js";
import { testSiteFixtureEnvelopeSize } from "../model/test-site-fixture-geometry.js";

function variantFor(id, count) {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % count;
}

function fixtureWorldTransform(fixture, terrainHeightAt) {
  const [x, y, z] = fixture.pose.positionM;
  return {
    x,
    y: terrainHeightAt(x, z) + y,
    z,
    headingRad: fixture.pose.headingRad,
  };
}

/** Consolidates dense repeated canonical fixtures into bounded draw batches. */
export function addTestSiteFixtureInstances({
  fixtures,
  terrainHeightAt,
  parent,
  materials,
}) {
  const trees = fixtures.filter(
      ({ presentation }) => presentation.key === "tree-trunk",
    ),
    rocks = fixtures.filter(({ presentation }) => presentation.key === "rock"),
    root = new THREE.Group(),
    dummy = new THREE.Object3D();
  root.name = "test-site-fixture-instances";
  parent.add(root);

  if (trees.length) {
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.38, 0.57, 1, 10),
      materials.bark,
      trees.length,
    );
    trunks.name = "fixture-tree-trunks";
    trunks.castShadow = trunks.receiveShadow = true;
    const crownsByMaterial = materials.leaves.map(() => []),
      conifers = [];
    trees.forEach((fixture, treeIndex) => {
      const [width, height] = testSiteFixtureEnvelopeSize(fixture),
        transform = fixtureWorldTransform(fixture, terrainHeightAt),
        variant = variantFor(fixture.id, 3);
      dummy.position.set(transform.x, transform.y + height / 2, transform.z);
      dummy.rotation.set(0, transform.headingRad, 0);
      dummy.scale.set(width, height, width);
      dummy.updateMatrix();
      trunks.setMatrixAt(treeIndex, dummy.matrix);
      if (variant === 1) {
        for (const [heightRatio, radius] of [
          [0.59, 0.3],
          [0.76, 0.26],
          [0.9, 0.19],
        ]) {
          dummy.position.set(
            transform.x,
            transform.y + height * heightRatio,
            transform.z,
          );
          dummy.rotation.set(0, transform.headingRad, 0);
          dummy.scale.set(height * radius, height * 0.38, height * radius);
          dummy.updateMatrix();
          conifers.push(dummy.matrix.clone());
        }
      } else {
        const crowns =
          variant === 0
            ? [
                [0, 0.82, 0, 0.31, 0],
                [-0.15, 0.74, 0.08, 0.24, 1],
                [0.16, 0.77, -0.07, 0.26, 2],
              ]
            : [
                [-0.1, 0.78, 0.03, 0.28, 1],
                [0.12, 0.87, -0.02, 0.3, 0],
              ];
        for (const [ox, oy, oz, scale, materialIndex] of crowns) {
          dummy.position.set(
            transform.x + ox * height,
            transform.y + oy * height,
            transform.z + oz * height,
          );
          dummy.rotation.set(0, transform.headingRad, 0);
          dummy.scale.set(
            height * scale,
            height * scale * 0.78,
            height * scale,
          );
          dummy.updateMatrix();
          crownsByMaterial[materialIndex].push(dummy.matrix.clone());
        }
      }
    });
    trunks.instanceMatrix.needsUpdate = true;
    root.add(trunks);
    crownsByMaterial.forEach((matrices, index) => {
      if (!matrices.length) return;
      const crowns = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 0),
        materials.leaves[index],
        matrices.length,
      );
      crowns.name = `fixture-tree-crowns:${index}`;
      matrices.forEach((matrix, matrixIndex) =>
        crowns.setMatrixAt(matrixIndex, matrix),
      );
      crowns.instanceMatrix.needsUpdate = true;
      crowns.castShadow = crowns.receiveShadow = true;
      root.add(crowns);
    });
    if (conifers.length) {
      const coniferCrowns = new THREE.InstancedMesh(
        new THREE.ConeGeometry(1, 1, 9),
        materials.leaves[1],
        conifers.length,
      );
      coniferCrowns.name = "fixture-tree-conifer-crowns";
      conifers.forEach((matrix, index) =>
        coniferCrowns.setMatrixAt(index, matrix),
      );
      coniferCrowns.instanceMatrix.needsUpdate = true;
      coniferCrowns.castShadow = coniferCrowns.receiveShadow = true;
      root.add(coniferCrowns);
    }
  }

  if (rocks.length) {
    const rockInstances = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.5, 0),
      materials.stone,
      rocks.length,
    );
    rockInstances.name = "fixture-terrain-rocks";
    rocks.forEach((fixture, index) => {
      const [width, height, depth] = testSiteFixtureEnvelopeSize(fixture),
        transform = fixtureWorldTransform(fixture, terrainHeightAt),
        variant = variantFor(fixture.id, 3);
      dummy.position.set(transform.x, transform.y + height / 2, transform.z);
      dummy.rotation.set(
        0.12 + variant * 0.09,
        transform.headingRad + variant * 0.31,
        -0.08 - variant * 0.05,
      );
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      rockInstances.setMatrixAt(index, dummy.matrix);
    });
    rockInstances.instanceMatrix.needsUpdate = true;
    rockInstances.castShadow = rockInstances.receiveShadow = true;
    root.add(rockInstances);
  }
  return root;
}

function addTree(group, fixture, materials) {
  const [width, height] = testSiteFixtureEnvelopeSize(fixture),
    variant = variantFor(fixture.id, 3),
    trunk = mesh(
      new THREE.CylinderGeometry(width * 0.38, width * 0.57, height, 10),
      materials.bark,
      [0, height / 2, 0],
      [],
      group,
    );
  trunk.castShadow = true;
  if (variant === 1) {
    for (const [y, radius, materialIndex] of [
      [0.58, 0.31, 0],
      [0.76, 0.27, 1],
      [0.91, 0.2, 2],
    ])
      mesh(
        new THREE.ConeGeometry(height * radius, height * 0.42, 9),
        materials.leaves[materialIndex],
        [0, height * y, 0],
        [],
        group,
      );
    return;
  }
  const crowns =
    variant === 0
      ? [
          [0, 0.82, 0, 0.5, 0],
          [-0.29, 0.72, 0.15, 0.35, 1],
          [0.31, 0.75, -0.13, 0.39, 2],
        ]
      : [
          [-0.16, 0.77, 0.05, 0.42, 1],
          [0.2, 0.86, -0.04, 0.44, 0],
        ];
  for (const [ox, oy, oz, scale, materialIndex] of crowns) {
    const crown = mesh(
      new THREE.IcosahedronGeometry(height * scale, 1),
      materials.leaves[materialIndex],
      [ox * height, oy * height, oz * height],
      [],
      group,
    );
    crown.scale.set(0.56, variant === 2 ? 0.5 : 0.39, 0.54);
  }
}

function addRock(group, fixture, materials) {
  const [width, height, depth] = testSiteFixtureEnvelopeSize(fixture),
    variant = variantFor(fixture.id, 3),
    geometry =
      variant === 0
        ? new THREE.DodecahedronGeometry(0.5, 1)
        : variant === 1
          ? new THREE.IcosahedronGeometry(0.5, 1)
          : new THREE.OctahedronGeometry(0.5, 2),
    rock = mesh(
      geometry,
      materials.stone,
      [0, height / 2, 0],
      [0.12 + variant * 0.09, 0.25, -0.08 - variant * 0.05],
      group,
    );
  rock.scale.set(width, height, depth);
}

function addSign(group, fixture, materials) {
  const [width, height, depth] = testSiteFixtureEnvelopeSize(fixture);
  mesh(
    new THREE.CylinderGeometry(0.055, 0.07, height, 8),
    materials.signPost,
    [0, height / 2, 0],
    [],
    group,
  );
  if (fixture.id === "airfield-sign") {
    const sock = mesh(
      new THREE.ConeGeometry(height * 0.13, width * 0.78, 10, 1, true),
      materials.warning,
      [width * 0.36, height * 0.84, 0],
      [0, 0, -Math.PI / 2],
      group,
    );
    sock.scale.z = 0.62;
    return;
  }
  mesh(
    new THREE.BoxGeometry(width, height * 0.44, depth),
    materials.signFace,
    [0, height * 0.77, 0],
    [],
    group,
  );
  mesh(
    new THREE.BoxGeometry(width * 0.86, height * 0.045, depth * 1.06),
    materials.warning,
    [0, height * 0.79, depth * 0.54],
    [],
    group,
  );
}

function addBuilding(group, fixture, materials) {
  const [width, height, depth] = testSiteFixtureEnvelopeSize(fixture),
    shell = mesh(
      new THREE.BoxGeometry(width, height, depth),
      materials.stone,
      [0, height / 2, 0],
      [],
      group,
    ),
    roof = mesh(
      new THREE.BoxGeometry(width + 1.2, 0.55, depth + 1.2),
      materials.signPost,
      [0, height + 0.22, 0],
      [],
      group,
    );
  shell.castShadow = shell.receiveShadow = true;
  roof.castShadow = true;
  const doorWidth = Math.min(20, width * 0.38),
    doorHeight = height * 0.68;
  mesh(
    new THREE.BoxGeometry(doorWidth, doorHeight, 0.18),
    materials.signFace,
    [0, doorHeight / 2, -depth / 2 - 0.1],
    [],
    group,
  );
  for (const offsetX of [-width * 0.36, width * 0.36])
    mesh(
      new THREE.BoxGeometry(width * 0.17, height * 0.2, 0.16),
      materials.warning,
      [offsetX, height * 0.67, -depth / 2 - 0.09],
      [],
      group,
    );
}

function addBridge(group, fixture, materials) {
  fixture.collisionGeometry.children.forEach((child, index) => {
    if (child.geometry.kind !== "box") return;
    const bridgePart = mesh(
      new THREE.BoxGeometry(...child.geometry.sizeM),
      index === 1 || index === 2 ? materials.signPost : materials.stone,
      child.offsetM,
      child.rotationEulerRad,
      group,
    );
    bridgePart.castShadow = bridgePart.receiveShadow = true;
  });
  const deck = fixture.collisionGeometry.children[0];
  if (deck?.geometry.kind === "box")
    for (const offsetX of [-1.25, 1.25])
      mesh(
        new THREE.BoxGeometry(0.48, 0.035, deck.geometry.sizeM[2] * 0.97),
        materials.signPost,
        [offsetX, deck.offsetM[1] + deck.geometry.sizeM[1] / 2 + 0.02, 0],
        [],
        group,
      );
}

function addApronRamp(group, fixture, materials) {
  for (const child of fixture.collisionGeometry.children) {
    const ramp = mesh(
      new THREE.BoxGeometry(...child.geometry.sizeM),
      materials.stone,
      child.offsetM,
      child.rotationEulerRad,
      group,
    );
    ramp.receiveShadow = true;
  }
}

/** Builds varied visuals inside each canonical fixture's collision envelope. */
export function addTestSiteFixtureVisual({
  fixture,
  groundY,
  parent,
  materials,
}) {
  const [x, y, z] = fixture.pose.positionM,
    [width, height, depth] = testSiteFixtureEnvelopeSize(fixture),
    key = fixture.presentation.key,
    group = new THREE.Group();
  group.name = `test-fixture:${fixture.id}`;
  group.position.set(x, groundY + y, z);
  group.rotation.y = fixture.pose.headingRad;
  parent.add(group);
  if (key === "tree-trunk") addTree(group, fixture, materials);
  else if (key === "rock") addRock(group, fixture, materials);
  else if (key === "building") addBuilding(group, fixture, materials);
  else if (key === "bridge") addBridge(group, fixture, materials);
  else if (key === "apron-ramp") addApronRamp(group, fixture, materials);
  else if (key === "log") {
    mesh(
      new THREE.CylinderGeometry(depth / 2, depth / 2, width, 14),
      materials.bark,
      [0, depth / 2, 0],
      [0, 0, Math.PI / 2],
      group,
    );
    for (const endX of [-width / 2, width / 2])
      mesh(
        new THREE.TorusGeometry(depth * 0.34, depth * 0.055, 5, 12),
        materials.woodCut,
        [endX, depth / 2, 0],
        [0, Math.PI / 2, 0],
        group,
      );
  } else if (key === "sign") addSign(group, fixture, materials);
  else if (key === "marker")
    mesh(
      new THREE.CylinderGeometry(width / 2, width / 2, height, 10),
      materials.warning,
      [0, height / 2, 0],
      [],
      group,
    );
  else
    mesh(
      new THREE.BoxGeometry(width, height, depth),
      materials.stone,
      [0, height / 2, 0],
      [],
      group,
    );
  return group;
}
