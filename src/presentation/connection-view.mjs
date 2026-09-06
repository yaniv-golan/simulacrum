import * as THREE from 'three';
import { createResourceCache } from './resource-cache.mjs';

const colorFor = (kind) => (kind === 'power' ? 0xfbc16c : kind === 'signal' ? 0x68d9d0 : 0xc7d8df);
const electric = (kind) => kind === 'power' || kind === 'signal';
const styleKey = (s) =>
  JSON.stringify([
    s.kind,
    s.exploded,
    s.exploded && s.highlighted,
    !electric(s.kind) && s.failed,
    !electric(s.kind) && s.ends[0].distanceTo(s.ends[1]) > 1e-5,
  ]);
function disposeGroup(group) {
  group.removeFromParent();
  group.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
}

// Keep the GPU buffers while reshaping the cable to the completed endpoint poses.
function updateTube(geometry, path) {
  const { tubularSegments, radialSegments, radius } = geometry.parameters;
  path.updateArcLengths();
  const frames = path.computeFrenetFrames(tubularSegments, false);
  const positions = geometry.attributes.position,
    normals = geometry.attributes.normal,
    point = new THREE.Vector3(),
    normal = new THREE.Vector3();
  for (let i = 0; i <= tubularSegments; i++) {
    path.getPointAt(i / tubularSegments, point);
    for (let j = 0; j <= radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2,
        index = i * (radialSegments + 1) + j;
      normal
        .copy(frames.normals[i])
        .multiplyScalar(-Math.cos(angle))
        .addScaledVector(frames.binormals[i], Math.sin(angle))
        .normalize();
      normals.setXYZ(index, normal.x, normal.y, normal.z);
      positions.setXYZ(
        index,
        point.x + radius * normal.x,
        point.y + radius * normal.y,
        point.z + radius * normal.z,
      );
    }
  }
  positions.needsUpdate = normals.needsUpdate = true;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}

export function createConnectionView(parent) {
  const cache = createResourceCache({
    key: styleKey,
    dispose: (resource) => disposeGroup(resource.group),
    create(spec) {
      const group = new THREE.Group(),
        color = colorFor(spec.kind),
        electrical = electric(spec.kind),
        up = new THREE.Vector3(0, 1, 0),
        updates = [];
      parent.add(group);
      function markers(indices, radius, material) {
        for (const index of indices) {
          const marker = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material());
          if (spec.exploded) marker.userData.connectionId = spec.id;
          group.add(marker);
          updates.push((ends) => marker.position.copy(ends[index]));
        }
      }
      if (spec.exploded || (!electrical && spec.failed)) {
        const highlighted = spec.exploded && spec.highlighted,
          line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(spec.ends),
            new THREE.LineDashedMaterial({
              color: spec.exploded ? (highlighted ? 0xffffff : color) : 0xff9a47,
              dashSize: 0.025,
              gapSize: 0.015,
              ...(spec.exploded ? { transparent: true, opacity: highlighted ? 1 : 0.8 } : {}),
            }),
          );
        line.geometry.setAttribute('lineDistance', new THREE.Float32BufferAttribute([0, 0], 1));
        if (spec.exploded) line.userData.connectionId = spec.id;
        group.add(line);
        updates.push((ends) => {
          const position = line.geometry.attributes.position;
          for (let i = 0; i < 2; i++) position.setXYZ(i, ...ends[i].toArray());
          position.needsUpdate = true;
          line.geometry.computeBoundingSphere();
          line.geometry.attributes.lineDistance.setX(1, ends[0].distanceTo(ends[1]));
          line.geometry.attributes.lineDistance.needsUpdate = true;
        });
        if (spec.exploded)
          markers(
            [0, 1],
            highlighted ? 0.014 : 0.009,
            () => new THREE.MeshBasicMaterial({ color: highlighted ? 0xffffff : color }),
          );
      } else {
        if (electrical) {
          const path = new THREE.QuadraticBezierCurve3(
              spec.ends[0].clone(),
              spec.ends[0].clone().lerp(spec.ends[1], 0.5),
              spec.ends[1].clone(),
            ),
            geometry = new THREE.TubeGeometry(
              path,
              20,
              spec.kind === 'power' ? 0.005 : 0.004,
              8,
              false,
            ),
            cable = new THREE.Mesh(
              geometry,
              new THREE.MeshStandardMaterial({
                color,
                roughness: 0.6,
                emissive: color,
                emissiveIntensity: 0.1,
              }),
            );
          group.add(cable);
          updates.push((ends) => {
            path.v0.copy(ends[0]);
            path.v2.copy(ends[1]);
            path.v1.copy(ends[0]).lerp(ends[1], 0.5);
            path.v1.y += Math.min(0.12, ends[0].distanceTo(ends[1]) * 0.2 + 0.035);
            updateTube(geometry, path);
          });
        } else if (spec.ends[0].distanceTo(spec.ends[1]) > 1e-5) {
          const shaft = new THREE.Mesh(
            new THREE.CylinderGeometry(0.009, 0.009, 1, 12),
            new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.3 }),
          );
          group.add(shaft);
          updates.push((ends) => {
            const direction = ends[1].clone().sub(ends[0]);
            shaft.scale.y = direction.length();
            shaft.position.copy(ends[0]).lerp(ends[1], 0.5);
            shaft.quaternion.setFromUnitVectors(up, direction.normalize());
          });
        }
        markers(
          electrical ? [0, 1] : [0],
          electrical ? 0.007 : 0.009,
          () => new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35 }),
        );
      }
      let previous = null;
      return {
        group,
        update(ends) {
          const next = ends.flatMap((p) => p.toArray());
          if (previous && next.every((value, i) => value === previous[i])) return;
          for (const update of updates) update(ends);
          previous = next;
        },
      };
    },
  });
  return {
    resources: cache.values,
    update(specs) {
      cache.reconcile(specs);
      for (const spec of specs) cache.values.get(spec.id).update(spec.ends);
    },
    dispose: () => cache.dispose(),
  };
}
