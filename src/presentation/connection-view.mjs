// @ts-check
/** @typedef {import('./connection-render.js').ConnectionRenderSpec} Spec */
/** @typedef {{group: THREE.Group, update: (ends: Spec['ends']) => void}} Resource */
import * as THREE from 'three';
import { createResourceCache } from './resource-cache.mjs';

/** @param {Spec["kind"]} kind */
const colorFor = (kind) => (kind === 'power' ? 0xfbc16c : kind === 'signal' ? 0x68d9d0 : 0xc7d8df);
/** @param {Spec["kind"]} kind */
const electric = (kind) => kind === 'power' || kind === 'signal';
/** @param {Spec} s */
const styleKey = (s) =>
  JSON.stringify([
    s.kind,
    s.exploded,
    s.highlighted,
    !electric(s.kind) && s.failed,
    !electric(s.kind) && s.ends[0].distanceTo(s.ends[1]) > 1e-5,
  ]);
/** @param {THREE.Group} group */
function disposeGroup(group) {
  group.removeFromParent();
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    }
  });
}

/** @param {THREE.Object3D} parent */
export function createConnectionView(parent) {
  const cache = createResourceCache({
    key: styleKey,
    dispose: (resource) => disposeGroup(resource.group),
    /** @param {Spec} spec @returns {Resource} */
    create(spec) {
      const group = new THREE.Group(),
        color = colorFor(spec.kind),
        electrical = electric(spec.kind),
        up = new THREE.Vector3(0, 1, 0),
        updates = /** @type {((ends: Spec["ends"]) => void)[]} */ ([]);
      parent.add(group);
      /** @param {(0|1)[]} indices @param {number} radius @param {() => THREE.Material} material */
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
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(spec.ends),
            new THREE.LineBasicMaterial({ color: spec.highlighted ? 0xffefc7 : color }),
          );
          group.add(line);
          updates.push((ends) => {
            const position = line.geometry.attributes.position;
            for (let i = 0; i < 2; i++) position.setXYZ(i, ...ends[i].toArray());
            position.needsUpdate = true;
            line.geometry.computeBoundingSphere();
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
          electrical || spec.kind === 'spring' ? [0, 1] : [0],
          electrical ? 0.007 : 0.009,
          () => new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35 }),
        );
      }
      /** @type {number[] | null} */
      let previous = null;
      return {
        group,
        update(ends) {
          const next = ends.flatMap((p) => p.toArray());
          const prior = previous;
          if (prior && next.every((value, i) => value === prior[i])) return;
          for (const update of updates) update(ends);
          previous = next;
        },
      };
    },
  });
  return {
    resources: cache.values,
    /** @param {readonly Spec[]} specs */
    update(specs) {
      cache.reconcile(specs);
      for (const spec of specs) {
        const resource = cache.values.get(spec.id);
        if (!resource) throw Error(`Missing connection resource: ${spec.id}`);
        resource.group.visible = spec.visible;
        resource.update(spec.ends);
      }
    },
    pickableObjects: () =>
      [...cache.values.values()]
        .filter((resource) => resource.group.visible)
        .map((resource) => resource.group),
    dispose: () => cache.dispose(),
  };
}
