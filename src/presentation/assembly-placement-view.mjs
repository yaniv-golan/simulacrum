import * as THREE from 'three';
import { createAssemblyPlacement } from './assembly-placement.mjs';
import { multiplyQuaternion } from '../model/transforms.mjs';
import { explainFailure } from '../model/messages.mjs';
const el = (tag, text = '') => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
const button = (text, fn) => {
  const n = el('button', text);
  n.type = 'button';
  n.onclick = fn;
  return n;
};
export function createAssemblyPlacementView({
  getFrame,
  send,
  scene,
  camera,
  canvas,
  orbit,
  getMachineMeshes,
  createMesh,
  disposeMesh,
  invalidate,
  onDone,
  onCancel,
  onState,
}) {
  const proposal = createAssemblyPlacement({ getFrame, send }),
    panel = el('section');
  panel.className = 'assembly-placement';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Assembly placement');
  panel.setAttribute('role', 'region');
  panel.tabIndex = -1;
  const title = el('h3'),
    status = el('p');
  status.setAttribute('role', 'status');
  const controls = el('fieldset'),
    step = el('select');
  step.setAttribute('aria-label', 'Position increment');
  for (const n of [0.005, 0.025, 0.1]) {
    const o = el('option', `${n * 1000} mm`);
    o.value = n;
    step.append(o);
  }
  step.value = '0.025';
  const precision = el('details');
  precision.append(
    el('summary', 'Precise position'),
    el('p', 'World position · rotation about X, Y, then Z.'),
  );
  const fields = [];
  for (let i = 0; i < 3; i++) {
    const label = el('label', `${'XYZ'[i]} (m)`),
      field = el('input');
    field.type = 'number';
    field.step = 'any';
    field.setAttribute('aria-label', `Insert assembly ${'XYZ'[i]} (m)`);
    field.onchange = () => {
      const s = proposal.read();
      if (!Number.isFinite(field.valueAsNumber)) {
        render();
        return;
      }
      const p = [...s.position];
      p[i] = field.valueAsNumber;
      proposal.pose(p);
      render();
    };
    label.append(field);
    precision.append(label);
    fields.push(field);
  }
  const turn = el('select');
  turn.setAttribute('aria-label', 'Rotation axis');
  for (const a of ['X', 'Y', 'Z']) {
    const o = el('option', a);
    turn.append(o);
  }
  turn.value = 'Y';
  function rotate() {
    const s = proposal.read(),
      q = [0, 0, 0, Math.SQRT1_2];
    q['XYZ'.indexOf(turn.value)] = Math.SQRT1_2;
    proposal.pose(s.position, multiplyQuaternion(q, s.rotation));
    render();
  }
  const rotationFields = [];
  for (let i = 0; i < 3; i++) {
    const label = el('label', `${'XYZ'[i]} rotation (°)`),
      field = el('input');
    field.type = 'number';
    field.step = 'any';
    field.setAttribute('aria-label', `Insert assembly ${'XYZ'[i]} rotation (degrees)`);
    field.onchange = () => {
      if (!Number.isFinite(field.valueAsNumber)) {
        render();
        return;
      }
      const s = proposal.read();
      const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...s.rotation), 'XYZ');
      const values = [e.x, e.y, e.z];
      values[i] = THREE.MathUtils.degToRad(field.valueAsNumber);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...values, 'XYZ'));
      proposal.pose(s.position, q.toArray());
      render();
    };
    label.append(field);
    precision.append(label);
    rotationFields.push(field);
  }

  const nudge = (i, sign) => {
    const s = proposal.read(),
      p = [...s.position];
    p[i] += sign * Number(step.value);
    proposal.pose(p);
    render();
  };
  const nudges = el('div');
  nudges.className = 'assembly-nudges';
  for (let i = 0; i < 3; i++)
    for (const sign of [-1, 1])
      nudges.append(button(`${'XYZ'[i]} ${sign > 0 ? '+' : '−'}`, () => nudge(i, sign)));
  const revalidate = button('Revalidate', () => {
    proposal.revalidate();
    render();
  });
  const apply = button('Place', async () => {
    const promise = proposal.commit();
    render();
    const reply = await promise;
    render();
    if (reply?.ok) accepted();
  });
  function accepted() {
    const id = proposal.read().instanceId;
    clearGhost();
    panel.hidden = true;
    onDone(id);
    onState();
  }
  apply.className = 'primary';
  const cancel = button('Cancel placement', () => {
    if (proposal.cancel()) {
      clearGhost();
      panel.hidden = true;
      onState();
      onCancel();
    }
  });
  controls.append(step, nudges, turn, button('Rotate 90°', rotate), precision);
  const actions = el('div');
  actions.className = 'assembly-placement-actions';
  actions.append(apply, cancel);
  panel.append(title, status, controls, revalidate, actions);
  let ghost = new THREE.Group(),
    ghostKey = '',
    lastItem = null;
  scene.add(ghost);
  function clearGhost() {
    for (const mesh of [...ghost.children]) {
      ghost.remove(mesh);
      disposeMesh(mesh);
    }
    ghostKey = '';
    invalidate();
  }
  function render() {
    const s = proposal.read();
    if (!s) {
      panel.hidden = true;
      return;
    }
    title.textContent = `Placing: ${s.definition.name}`;
    const busy = s.phase === 'committing';
    status.textContent = busy
      ? (s.error?.message ?? 'Applying placement…')
      : s.stale
        ? 'Machine changed. Revalidate before placing.'
        : s.error
          ? s.error.reasonCode
            ? explainFailure(s.error, getFrame().metadata.blueprint)
            : s.error.message
          : 'Click the workbench to position. Place confirms; no outside connection is added.';
    controls.disabled = busy || s.stale;
    revalidate.hidden = !s.stale;
    revalidate.disabled = busy || getFrame().metadata.mode !== 'build';
    apply.disabled = busy || s.stale || !s.valid;
    cancel.disabled = busy;
    for (let i = 0; i < 3; i++)
      if (document.activeElement !== fields[i])
        fields[i].value = String(Number(s.position[i].toPrecision(12)));
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...s.rotation), 'XYZ');
    for (let i = 0; i < 3; i++)
      if (document.activeElement !== rotationFields[i])
        rotationFields[i].value = String(
          Number(THREE.MathUtils.radToDeg([e.x, e.y, e.z][i]).toPrecision(10)),
        );
    const key = JSON.stringify([s.parts, s.valid, s.stale]);
    if (key !== ghostKey) {
      clearGhost();
      ghostKey = key;
      for (const part of s.parts) {
        const mesh = createMesh(part);
        mesh.position.fromArray(part.position);
        mesh.quaternion.fromArray(part.rotation);
        mesh.traverse((o) => {
          if (o.material) {
            o.material.transparent = true;
            o.material.opacity = 0.55;
            o.material.depthWrite = false;
            if (o.material.emissive)
              o.material.emissive.setHex(s.valid && !s.stale ? 0x164636 : 0x73271a);
          }
        });
        ghost.add(mesh);
      }
      invalidate();
    }
    onState();
  }
  const ray = new THREE.Raycaster();
  function point(event) {
    const s = proposal.read();
    if (!s || s.phase !== 'preview' || s.stale) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(
        (2 * (event.clientX - r.left)) / r.width - 1,
        1 - (2 * (event.clientY - r.top)) / r.height,
      ),
      camera,
    );
    const p = ray.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -s.position[1]),
      new THREE.Vector3(),
    );
    if (p) {
      proposal.pose([p.x, s.position[1], p.z]);
      render();
    }
  }
  return {
    panel,
    start(item) {
      const old = lastItem?.id === item.id ? proposal.read() : null;
      if (!proposal.start(item.definition, old)) return false;
      lastItem = item;
      panel.hidden = false;
      render();
      const bounds = new THREE.Box3().setFromObject(ghost);
      for (const mesh of getMachineMeshes()) bounds.union(new THREE.Box3().setFromObject(mesh));
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const direction = camera.position.clone().sub(orbit.target).normalize();
      const distance =
        (sphere.radius * 1.2) /
        Math.sin(
          Math.atan(
            Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect),
          ),
        );
      camera.position.copy(sphere.center).addScaledVector(direction, Math.max(distance, 0.1));
      orbit.target.copy(sphere.center);
      orbit.update();
      invalidate();
      panel.focus();
    },
    repeat() {
      if (lastItem) this.start(lastItem);
    },
    active: () => !!proposal.read() && proposal.read().phase !== 'accepted',
    committing: () => proposal.read()?.phase === 'committing',
    point,
    confirm() {
      apply.click();
    },
    cancel() {
      cancel.click();
    },
    refresh() {
      const reply = proposal.refresh();
      if (reply?.ok) accepted();
      else if (this.active()) render();
    },
    key(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel.click();
        return;
      }
      if (event.target.matches('input,select,textarea,button,summary')) return;
      const map = {
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
        ArrowUp: [2, -1],
        ArrowDown: [2, 1],
        PageUp: [1, 1],
        PageDown: [1, -1],
      };
      if (map[event.key]) {
        event.preventDefault();
        nudge(...map[event.key]);
      }
      if (event.key === 'Enter') apply.click();
    },
    dispose() {
      clearGhost();
      scene.remove(ghost);
      panel.remove();
    },
    hasPrevious: () => !!lastItem,
  };
}
