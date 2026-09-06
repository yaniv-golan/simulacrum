import * as THREE from 'three';
import { explainFailure } from '../model/messages.mjs';
import { surfaceRegions } from '../model/surfaces.mjs';
import { inspectSurfaceMount } from '../model/assembly.mjs';
import { mechanicalGroup } from '../model/editing.mjs';

const node = (tag, text) => {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  return e;
};
const vec = (a) => new THREE.Vector3(...a),
  quat = (a) => new THREE.Quaternion(...a);
/** Surface authoring previews are isolated from the completed physical read model. */
export function createSurfaceControls({
  scene,
  camera,
  renderer,
  orbit,
  getFrame,
  getCursor,
  getMeshes,
  send,
  onMessage,
  onInteraction,
  createMesh,
}) {
  const panel = node('section');
  panel.className = 'surface-placement';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Surface placement');
  const title = node('strong', 'Snap to surface'),
    status = node('p');
  status.setAttribute('role', 'status');
  const fields = node('div');
  fields.className = 'surface-fields';
  function selectField(label) {
    const wrap = node('label', label),
      input = node('select');
    input.setAttribute('aria-label', label);
    wrap.append(input);
    fields.append(wrap);
    return input;
  }
  const source = selectField('Mounting face'),
    target = selectField('Target surface'),
    grid = selectField('Placement grid');
  for (const [value, label] of [
    ['.025', '25 mm'],
    ['.001', 'Fine · 1 mm'],
    ['0', 'Free'],
  ]) {
    const o = node('option', label);
    o.value = value;
    grid.append(o);
  }
  function numeric(label, step) {
    const wrap = node('label', label),
      input = node('input');
    input.type = 'number';
    input.step = step;
    input.value = '0';
    input.setAttribute('aria-label', label);
    wrap.append(input);
    fields.append(wrap);
    return input;
  }
  const u = numeric('Along surface (mm)', '1'),
    v = numeric('Across surface (mm)', '1'),
    angle = numeric('Turn (degrees)', '15');
  const precise = node('details');
  precise.className = 'surface-precise';
  precise.append(node('summary', 'Precise position'));
  const preciseFields = node('div');
  preciseFields.className = 'surface-fields';
  for (const input of [u, v, angle]) preciseFields.append(input.parentElement);
  precise.append(node('p', 'Gold arrow: Along · Blue arrow: Across'), preciseFields);
  const actions = node('div');
  actions.className = 'surface-actions';
  function action(label, fn) {
    const b = node('button', label);
    b.type = 'button';
    b.addEventListener('click', fn);
    actions.append(b);
    return b;
  }
  action('Turn −90°', () => turn(-90));
  action('Turn +90°', () => turn(90));
  action('Center', () => {
    u.value = v.value = '0';
    update();
  });
  action('Edge toward camera', () => alignEdge(true));
  action('Edge away from camera', () => alignEdge(false));
  function alignEdge(toward) {
    if (!state?.target) return;
    const p = bp().parts.find((p) => p.id === state.target.part),
      r = surfaceRegions(p).find((r) => r.id === state.target.region),
      part = state.insertPart ?? bp().parts.find((p) => p.id === state.part),
      pad = surfaceRegions(part).find((r) => r.id === source.value),
      theta = (Number(angle.value) * Math.PI) / 180,
      ext = pad.padHalfSize ?? pad.halfSize,
      lu = r.halfSize[0] - Math.abs(Math.cos(theta)) * ext[0] - Math.abs(Math.sin(theta)) * ext[1],
      lv = r.halfSize[1] - Math.abs(Math.sin(theta)) * ext[0] - Math.abs(Math.cos(theta)) * ext[1],
      direction = camera.position
        .clone()
        .sub(vec(p.position))
        .applyQuaternion(quat(p.rotation).multiply(quat(r.rotation)).invert()),
      sign = toward ? 1 : -1;
    if (Math.abs(direction.y) > Math.abs(direction.z))
      u.value = String(Math.sign(direction.y) * sign * Math.max(0, lu) * 1000);
    else v.value = String(Math.sign(direction.z) * sign * Math.max(0, lv) * 1000);
    update();
  }

  action('Change surface', () => {
    if (state) {
      state.locked = false;
      state.target = null;
      clearPreview();
      update();
    }
  });
  const apply = action('Attach', () => commit());
  apply.dataset.command = 'apply-surface';
  action('Cancel', () => cancel());
  const attachLabel = node('label'),
    attach = node('input');
  attach.type = 'checkbox';
  attach.checked = true;
  attach.setAttribute('aria-label', 'Attach after snapping');
  attachLabel.append(attach, document.createTextNode(' Attach after snapping'));
  panel.append(title, status, fields, attachLabel, actions, precise);
  const preview = new THREE.Group();
  scene.add(preview);
  let state = null,
    sequence = 0,
    enabled = true;
  const reasons = {
    SURFACE_OUT_OF_BOUNDS:
      'The mounting base extends beyond this surface. Slide it inward or choose a larger face.',
    UNKNOWN_SURFACE: 'Choose a suitable flat mounting surface.',
    MOUNT_HELD_BY_ANOTHER_CONNECTION:
      'Another attachment holds this group. Use Adjust mount or detach it first.',
    STALE_PROPOSAL: 'The machine changed. Start surface placement again.',
    MOUNT_OUTSIDE_SURFACE: 'The mounting base extends beyond this surface. Slide it inward.',
    SURFACE_OVERLAP: 'This position overlaps another part. Move it clear.',
    MOUNT_OVERLAP: 'This position overlaps another part. Move it clear.',
    MOUNT_COLLISION: 'This position overlaps another part. Move it clear.',
    INCOMPATIBLE_CONNECTION_LOOP:
      'Another attachment holds this group. Detach that connection first.',
    SURFACE_OCCUPIED: 'This mounting face is already attached.',
    INVALID_SURFACE: 'Choose a suitable flat mounting surface.',
  };
  function clearPreview() {
    for (const mesh of [...preview.children]) {
      preview.remove(mesh);
      mesh.traverse((o) => {
        if (!mesh.isArrowHelper) o.geometry?.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) {
          m?.map?.dispose();
          m?.dispose();
        }
      });
    }
    for (const mesh of getMeshes().values()) mesh.visible = true;
  }
  function bp() {
    return getFrame()?.metadata.blueprint;
  }
  function moving() {
    if (!state) return [];
    const base = structuredClone(bp());
    if (state.replaceConnection)
      base.connections = base.connections.filter((c) => c.id !== state.replaceConnection);
    return state.insertPart ? [state.part] : mechanicalGroup(base, state.part);
  }
  function start(part, { replaceConnection, insertPart, drag = false } = {}) {
    cancel(false);
    const value = insertPart ?? bp().parts.find((p) => p.id === part);
    if (!value || !surfaceRegions(value).length) return false;
    state = {
      part,
      replaceConnection,
      insertPart,
      drag,
      locked: false,
      target: null,
      blueprint: JSON.stringify(bp()),
      cursor: getCursor?.(),
      twist: 0,
      proposal: null,
    };
    source.replaceChildren();
    for (const r of surfaceRegions(value)) {
      const o = node('option', r.label);
      o.value = r.id;
      source.append(o);
    }
    source.value =
      surfaceRegions(value).find((r) => r.id === 'bottom')?.id ?? surfaceRegions(value)[0].id;
    target.replaceChildren(node('option', 'Choose a face in the scene'));
    const excluded = moving();
    for (const p of bp().parts)
      if (!excluded.includes(p.id))
        for (const r of surfaceRegions(p)) {
          const o = node('option', `${p.name} · ${r.label}`);
          o.value = JSON.stringify([p.id, r.id]);
          target.append(o);
        }
    u.value = v.value = angle.value = '0';
    panel.hidden = false;
    title.textContent = replaceConnection ? 'Adjust mount' : 'Snap to surface';
    apply.textContent = replaceConnection
      ? 'Apply mount'
      : attach.checked
        ? 'Attach'
        : 'Place only';
    if (replaceConnection) {
      const edge = bp().connections.find((c) => c.id === replaceConnection),
        own = edge?.a.part === part ? edge.a : edge?.b,
        other = edge?.a.part === part ? edge.b : edge?.a;
      if (own?.surface && other?.surface) {
        source.value = own.surface.region;
        state.target = { part: other.part, region: other.surface.region };
        state.locked = true;
        u.value = String(other.surface.u * 1000);
        v.value = String(other.surface.v * 1000);
        angle.value = String((other.surface.twist * 180) / Math.PI);
        target.value = JSON.stringify([other.part, other.surface.region]);
      }
    }
    update();
    onInteraction?.('surface-start', read());
    return true;
  }
  function preserveHeading() {
    if (!state?.target || state.replaceConnection || state.manualHeading) return;
    const part = state.insertPart ?? bp().parts.find((p) => p.id === state.part),
      receiver = bp().parts.find((p) => p.id === state.target.part),
      face = surfaceRegions(receiver).find((r) => r.id === state.target.region),
      pad = surfaceRegions(part).find((r) => r.id === source.value),
      world = quat(receiver.rotation).multiply(quat(face.rotation)),
      base = world
        .clone()
        .multiply(new THREE.Quaternion(0, 1, 0, 0))
        .multiply(quat(pad.rotation).invert()),
      delta = quat(part.rotation).multiply(base.invert()),
      normal = vec([1, 0, 0]).applyQuaternion(world);
    const radians =
      2 * Math.atan2(delta.x * normal.x + delta.y * normal.y + delta.z * normal.z, delta.w);
    angle.value = String(Math.round(((THREE.MathUtils.radToDeg(radians) + 540) % 360) - 180));
  }
  function options() {
    return {
      part: state.part,
      sourceRegion: source.value,
      targetPart: state.target.part,
      targetRegion: state.target.region,
      u: Number(u.value) / 1000,
      v: Number(v.value) / 1000,
      twist: (Number(angle.value) * Math.PI) / 180,
      id: state.replaceConnection ?? nextId(),
      ...(state.replaceConnection ? { replaceConnection: state.replaceConnection } : {}),
      ...(state.insertPart ? { insertPart: state.insertPart } : {}),
      attach: attach.checked,
    };
  }
  function nextId() {
    if (!state.id) {
      do {
        state.id = `surface-${++sequence}`;
      } while (bp().connections.some((c) => c.id === state.id));
    }
    return state.id;
  }
  function update() {
    if (!state) return;
    state.proposal = null;
    state.previewParts = [];
    clearPreview();
    apply.disabled = true;
    if (!state.target) {
      status.textContent =
        'Choose the top, side or underside of a part. Drag empty space to orbit.';
      return;
    }
    target.value = JSON.stringify([state.target.part, state.target.region]);
    try {
      const assessment = inspectSurfaceMount(bp(), options()),
        proposal = assessment.proposal;
      if (!proposal) throw assessment;
      state.proposal = assessment.valid ? proposal : null;
      state.previewParts = proposal.blueprint.parts.filter((p) =>
        proposal.movingPartIds.includes(p.id),
      );
      const ids = proposal.movingPartIds,
        color = assessment.valid ? 0xffc778 : 0xff836f;
      for (const part of proposal.blueprint.parts)
        if (ids.includes(part.id)) {
          const m = createMesh(part);
          m.position.fromArray(part.position);
          m.quaternion.fromArray(part.rotation);
          m.traverse((o) => {
            if (o.isMesh) {
              o.userData.partId = null;
              o.userData.surfacePreview = true;
            }
          });
          preview.add(m);
          const original = getMeshes().get(part.id);
          if (original) original.visible = false;
          if (part.type === 'poweredMotor') {
            const direction = vec([1, 0, 0]).applyQuaternion(quat(part.rotation)),
              arrow = new THREE.ArrowHelper(
                direction,
                vec(part.position),
                0.22,
                0xffffff,
                0.035,
                0.02,
              );
            arrow.line.material.depthTest = false;
            arrow.cone.material.depthTest = false;
            arrow.renderOrder = 31;
            preview.add(arrow);
          }
          const outline = new THREE.BoxHelper(m, color);
          outline.material.depthTest = false;
          preview.add(outline);
        }
      const targetPart = bp().parts.find((p) => p.id === state.target.part),
        region = surfaceRegions(targetPart).find((r) => r.id === state.target.region);
      const endpoint = {
        position: vec([0, Number(u.value) / 1000, Number(v.value) / 1000])
          .applyQuaternion(quat(region.rotation))
          .add(vec(region.position))
          .toArray(),
        rotation: region.rotation,
      };
      const center = vec(endpoint.position)
        .applyQuaternion(quat(targetPart.rotation))
        .add(vec(targetPart.position));
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.014, 0.02, 32),
        new THREE.MeshBasicMaterial({ color: 0x8cf5cf, side: THREE.DoubleSide, depthTest: false }),
      );
      marker.position.copy(center);
      marker.quaternion.copy(
        quat(targetPart.rotation)
          .multiply(quat(endpoint.rotation))
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
          ),
      );
      marker.renderOrder = 30;
      preview.add(marker);
      const targetRotation = quat(targetPart.rotation).multiply(quat(region.rotation)),
        tu = vec([0, 1, 0]).applyQuaternion(targetRotation),
        tv = vec([0, 0, 1]).applyQuaternion(targetRotation),
        targetCenter = vec(region.position)
          .applyQuaternion(quat(targetPart.rotation))
          .add(vec(targetPart.position));
      const facePoints = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
      ].map(([a, b]) =>
        targetCenter
          .clone()
          .addScaledVector(tu, a * region.halfSize[0])
          .addScaledVector(tv, b * region.halfSize[1]),
      );
      const faceLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(facePoints),
        new THREE.LineBasicMaterial({ color: 0x8cf5cf, depthTest: false }),
      );
      faceLine.renderOrder = 29;
      preview.add(faceLine);
      const sourcePart = state.insertPart ?? bp().parts.find((p) => p.id === state.part),
        pad = surfaceRegions(sourcePart).find((r) => r.id === source.value),
        padRotation = targetRotation
          .clone()
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(
              vec([1, 0, 0]),
              (Number(angle.value) * Math.PI) / 180,
            ),
          ),
        pu = vec([0, 1, 0]).applyQuaternion(padRotation),
        pv = vec([0, 0, 1]).applyQuaternion(padRotation);
      const padPoints = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
      ].map(([a, b]) =>
        center
          .clone()
          .addScaledVector(pu, a * (pad.padHalfSize ?? pad.halfSize)[0])
          .addScaledVector(pv, b * (pad.padHalfSize ?? pad.halfSize)[1]),
      );
      const footprint = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(padPoints),
        new THREE.LineDashedMaterial({
          color: 0x8cf5cf,
          dashSize: 0.01,
          gapSize: 0.006,
          depthTest: false,
        }),
      );
      footprint.computeLineDistances();
      footprint.renderOrder = 30;
      preview.add(footprint);
      const label = `${state.insertPart?.name ?? bp().parts.find((p) => p.id === state.part)?.name} → ${targetPart.name} · ${region.label}`;
      status.textContent = assessment.valid
        ? `${label}. Drag the preview to slide; click it or use ${apply.textContent} to confirm.${state.previewParts.some((p) => p.type === 'poweredMotor') ? ' White arrow: shaft direction. Turn it outward before attaching a wheel.' : ''}`
        : assessment.obstructingPartId
          ? `${state.insertPart?.name ?? bp().parts.find((p) => p.id === state.part).name} overlaps ${bp().parts.find((p) => p.id === assessment.obstructingPartId)?.name ?? assessment.obstructingPartId}. Slide or turn it clear.`
          : `${label}: ${reasons[assessment.reasonCode] ?? assessment.reasonCode}`;
      apply.disabled = !assessment.valid;
      if (assessment.obstructingPartId) {
        const obstacle = getMeshes().get(assessment.obstructingPartId);
        if (obstacle) {
          const box = new THREE.BoxHelper(obstacle, 0xff836f);
          box.material.depthTest = false;
          preview.add(box);
        }
      }
      for (const [direction, tint] of [
        [tu, 0xffc778],
        [tv, 0x8bcfff],
      ]) {
        const arrow = new THREE.ArrowHelper(direction, targetCenter, 0.16, tint, 0.025, 0.015);
        preview.add(arrow);
      }
    } catch (e) {
      status.textContent = reasons[e.reasonCode] ?? explainFailure(e);
      drawInvalidTarget();
    }
  }
  function drawInvalidTarget() {
    const p = bp().parts.find((p) => p.id === state.target?.part),
      r = p && surfaceRegions(p).find((r) => r.id === state.target.region);
    if (!r) return;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(r.halfSize[0] * 2, r.halfSize[1] * 2),
      new THREE.MeshBasicMaterial({
        color: 0xff836f,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    m.position.copy(vec(r.position).applyQuaternion(quat(p.rotation)).add(vec(p.position)));
    m.quaternion.copy(
      quat(p.rotation)
        .multiply(quat(r.rotation))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)),
    );
    preview.add(m);
  }
  function turn(degrees) {
    if (state) state.manualHeading = true;
    angle.value = String(Number(angle.value) + degrees);
    update();
  }
  async function commit() {
    if (!state?.proposal) return false;
    const command = {
        type: 'surface-mount',
        ...options(),
        ...(state.cursor ? { expectedCursor: state.cursor } : {}),
      },
      label = status.textContent;
    const result = await send(command);
    if (result?.ok) {
      cancel(false);
      onMessage(
        attach.checked
          ? 'Attached. The mount holds these parts together. Undo restores the previous position.'
          : 'Placed against surface · not attached.',
      );
      onInteraction?.('surface-committed', { command, label });
      return true;
    }
    return false;
  }
  function cancel(notify = true) {
    if (!state) return;
    state = null;
    clearPreview();
    panel.hidden = true;
    orbit.enabled = true;
    if (notify) onMessage('Surface placement cancelled. Your machine is unchanged.');
  }
  function ray(event) {
    const rect = renderer.domElement.getBoundingClientRect(),
      r = new THREE.Raycaster();
    r.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      ),
      camera,
    );
    return r;
  }
  function point(event, { lock = false } = {}) {
    if (!state) return false;
    const r = ray(event);
    let p, region, world;
    if (state.locked && state.target) {
      p = bp().parts.find((p) => p.id === state.target.part);
      region = surfaceRegions(p).find((r) => r.id === state.target.region);
      const normal = vec([1, 0, 0])
          .applyQuaternion(quat(region.rotation))
          .applyQuaternion(quat(p.rotation)),
        origin = vec(region.position).applyQuaternion(quat(p.rotation)).add(vec(p.position));
      world = r.ray.intersectPlane(
        new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin),
        new THREE.Vector3(),
      );
      if (!world) return true;
    } else {
      const excluded = moving(),
        hit = r
          .intersectObjects(
            [...getMeshes()].filter(([id]) => !excluded.includes(id)).map(([, m]) => m),
          )
          .find((h) => h.object.isMesh);
      if (!hit) {
        state.target = null;
        update();
        return false;
      }
      p = bp().parts.find((p) => p.id === hit.object.userData.partId);
      if (!p) return false;
      const localNormal = hit.face.normal
        .clone()
        .transformDirection(hit.object.matrixWorld)
        .applyQuaternion(quat(p.rotation).invert());
      region = surfaceRegions(p)
        .filter(
          (region) => vec([1, 0, 0]).applyQuaternion(quat(region.rotation)).dot(localNormal) > 0.95,
        )
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      if (!region) {
        state.target = null;
        update();
        return false;
      }
      world = hit.point;
      const changed = state.target?.part !== p.id || state.target?.region !== region.id;
      state.target = { part: p.id, region: region.id };
      if (changed) preserveHeading();
    }
    const local = world
        .clone()
        .sub(vec(p.position))
        .applyQuaternion(quat(p.rotation).invert())
        .sub(vec(region.position))
        .applyQuaternion(quat(region.rotation).invert()),
      spacing = Number(grid.value);
    let a = local.y,
      b = local.z;
    if (state.dragAnchor) {
      a = state.dragAnchor.u + local.y - state.dragAnchor.point[1];
      b = state.dragAnchor.v + local.z - state.dragAnchor.point[2];
    }
    if (spacing) {
      a = Math.round(a / spacing) * spacing;
      b = Math.round(b / spacing) * spacing;
    }
    // Keep a full mounting footprint on the face. Edge candidates use the moving
    // pad's projected extent and remain ordinary authored local coordinates.
    const part = state.insertPart ?? bp().parts.find((p) => p.id === state.part),
      base = surfaceRegions(part).find((r) => r.id === source.value),
      theta = (Number(angle.value) * Math.PI) / 180;
    const extU =
        Math.abs(Math.cos(theta)) * (base.padHalfSize ?? base.halfSize)[0] +
        Math.abs(Math.sin(theta)) * (base.padHalfSize ?? base.halfSize)[1],
      extV =
        Math.abs(Math.sin(theta)) * (base.padHalfSize ?? base.halfSize)[0] +
        Math.abs(Math.cos(theta)) * (base.padHalfSize ?? base.halfSize)[1];
    const limitU = region.halfSize[0] - extU,
      limitV = region.halfSize[1] - extV;
    const pixel =
      (camera.position.distanceTo(world) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
      renderer.domElement.clientHeight;
    function infer(value, limit, key) {
      const held = state[key];
      if (held !== undefined && Math.abs(value - held) < 14 * pixel) return held;
      const candidate = [0, -limit, limit]
        .filter(() => limit >= 0)
        .sort((x, y) => Math.abs(x - value) - Math.abs(y - value))[0];
      if (candidate !== undefined && Math.abs(candidate - value) < 8 * pixel) {
        state[key] = candidate;
        return candidate;
      }
      delete state[key];
      return spacing ? Math.round(value / spacing) * spacing : value;
    }
    a = infer(
      state.dragAnchor ? state.dragAnchor.u + local.y - state.dragAnchor.point[1] : local.y,
      limitU,
      'inferenceU',
    );
    b = infer(
      state.dragAnchor ? state.dragAnchor.v + local.z - state.dragAnchor.point[2] : local.z,
      limitV,
      'inferenceV',
    );
    u.value = String(Math.round(a * 1e6) / 1000);
    v.value = String(Math.round(b * 1e6) / 1000);
    if (lock) state.locked = true;
    update();
    return true;
  }
  source.addEventListener('change', () => {
    preserveHeading();
    update();
  });
  grid.addEventListener('change', update);
  attach.addEventListener('change', () => {
    apply.textContent = state?.replaceConnection
      ? 'Apply mount'
      : attach.checked
        ? 'Attach'
        : 'Place only';
    update();
  });
  for (const f of [u, v, angle])
    f.addEventListener('input', () => {
      if (f === angle && state) state.manualHeading = true;
      update();
    });
  target.addEventListener('change', () => {
    try {
      const [part, region] = JSON.parse(target.value);
      state.target = { part, region };
      state.locked = true;
      u.value = v.value = '0';
      preserveHeading();
      update();
    } catch {}
  });
  function key(event) {
    if (!state) return false;
    if (event.key === 'Escape') {
      cancel();
      return true;
    }
    if (event.key === 'Enter') {
      commit();
      return true;
    }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return false;
    if (event.key.startsWith('Arrow')) {
      if (event.altKey) turn(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -90 : 90);
      else if (state.target) {
        const targetPart = bp().parts.find((p) => p.id === state.target.part),
          region = surfaceRegions(targetPart).find((r) => r.id === state.target.region),
          horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key),
          direction = vec(horizontal ? [1, 0, 0] : [0, 1, 0])
            .applyQuaternion(camera.quaternion)
            .applyQuaternion(quat(targetPart.rotation).multiply(quat(region.rotation)).invert()),
          length = Math.hypot(direction.y, direction.z),
          sign = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1,
          step = (Number(grid.value) || 0.001) * 1000 * sign;
        u.value = String(
          Number(u.value) + step * (length > 1e-6 ? direction.y / length : horizontal ? 1 : 0),
        );
        v.value = String(
          Number(v.value) + step * (length > 1e-6 ? direction.z / length : horizontal ? 0 : 1),
        );
        update();
      }
      return true;
    }
    return false;
  }
  function beginPointer(event) {
    if (!state) return false;
    state.pointerStart = [event.clientX, event.clientY];
    state.previewClicked = false;
    const r = ray(event),
      previewHit = r
        .intersectObjects(preview.children)
        .find((h) => h.object.userData.surfacePreview);
    if (previewHit && state.target) {
      state.previewClicked = true;
      const p = bp().parts.find((p) => p.id === state.target.part),
        region = surfaceRegions(p).find((r) => r.id === state.target.region),
        rotation = quat(p.rotation).multiply(quat(region.rotation)),
        origin = vec(region.position).applyQuaternion(quat(p.rotation)).add(vec(p.position)),
        normal = vec([1, 0, 0]).applyQuaternion(rotation),
        world = r.ray.intersectPlane(
          new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin),
          new THREE.Vector3(),
        );
      if (!world) return false;
      const local = world.sub(origin).applyQuaternion(rotation.invert());
      state.dragAnchor = {
        point: local.toArray(),
        u: Number(u.value) / 1000,
        v: Number(v.value) / 1000,
      };
      state.locked = true;
      return true;
    }
    const hit = r
      .intersectObjects([...getMeshes()].filter(([id]) => !moving().includes(id)).map(([, m]) => m))
      .find((h) => h.object.isMesh);
    if (!hit) return false;
    if (state.locked && hit.object.userData.partId !== state.target?.part) return false;
    return point(event, { lock: true });
  }
  function endPointer(event) {
    if (!state) return;
    const click =
      state.previewClicked &&
      state.pointerStart &&
      event &&
      Math.hypot(event.clientX - state.pointerStart[0], event.clientY - state.pointerStart[1]) < 5;
    state.dragAnchor = null;
    state.drag = false;
    if (click) commit();
  }
  function read() {
    return state
      ? {
          part: state.part,
          target: state.target,
          sourceRegion: source.value,
          u: Number(u.value) / 1000,
          v: Number(v.value) / 1000,
          twist: (Number(angle.value) * Math.PI) / 180,
          valid: !!state.proposal,
          movingPartIds: state.proposal?.movingPartIds ?? moving(),
          previewParts: (state.previewParts ?? []).map((p) => ({
            id: p.id,
            position: p.position,
            rotation: p.rotation,
          })),
          locked: state.locked,
          attach: attach.checked,
        }
      : null;
  }
  return {
    panel,
    start,
    point,
    beginPointer,
    endPointer,
    commit,
    cancel,
    key,
    read,
    active: () => !!state,
    enabled: () => enabled,
    setEnabled: (value) => {
      enabled = value;
      if (!value) cancel();
    },
    refresh() {
      if (
        state &&
        (getFrame()?.metadata.mode !== 'build' || JSON.stringify(bp()) !== state.blueprint)
      )
        cancel(false);
    },
    dispose() {
      cancel(false);
      scene.remove(preview);
    },
  };
}
