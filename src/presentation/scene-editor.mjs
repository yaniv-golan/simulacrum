import { createPrimitiveGeometry } from './primitive-geometry.mjs';
import { explainFailure } from '../model/messages.mjs';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as THREE from 'three';
import {
  authoredScene,
  createSceneObject,
  sceneLayout,
  sceneObjectDescriptors,
} from '../model/environment.mjs';
import { loadSave } from '../model/blueprint.mjs';
import { MATERIALS } from '../model/catalog.mjs';
import { createDocumentProposal } from './document-proposal.mjs';
const el = (tag, text = '') => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
const btn = (text, fn) => {
  const b = el('button', text);
  b.type = 'button';
  b.onclick = fn;
  return b;
};
export function sceneMesh(descriptor, preview = false) {
  const geometry = createPrimitiveGeometry({
    kind: descriptor.shape,
    halfExtents: descriptor.halfExtents,
  });
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: preview ? 0x42bfc7 : 0xd3a352,
      roughness: 0.8,
      transparent: preview,
      opacity: preview ? 0.45 : 1,
    }),
  );
  mesh.position.fromArray(descriptor.position);
  mesh.quaternion.fromArray(descriptor.rotation);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
export function createSceneEditor({
  getFrame,
  send,
  left,
  rightPanel,
  scene,
  camera,
  canvas,
  orbit,
  meshes,
  library,
  exportScene,
  onContext,
  onBusy,
  onTool,
  invalidate,
}) {
  let active = false,
    selected = null,
    previousVisibility = [],
    inspectorVisibility = [],
    lastKey = '',
    browserScene = null;
  const palette = el('div'),
    inspector = el('div'),
    dialog = el('dialog'),
    preview = new THREE.Group();
  palette.className = 'scene-catalogue';
  inspector.className = 'scene-inspector';
  dialog.className = 'scene-browser';
  palette.hidden = inspector.hidden = true;
  left.append(palette);
  rightPanel.append(inspector);
  scene.add(preview);
  const gizmo = new TransformControls(camera, canvas),
    proxy = new THREE.Object3D();
  let tool = 'select',
    dragging = false;
  scene.add(proxy, gizmo.getHelper());
  gizmo.addEventListener('dragging-changed', (event) => {
    dragging = event.value;
    orbit.enabled = !dragging;
    if (!dragging) render();
  });
  gizmo.addEventListener('objectChange', () => {
    if (!dragging) return;
    updateDraft((s) => {
      const o = s.objects.find((o) => o.id === selected);
      if (o) {
        o.position = proxy.position.toArray();
        o.rotation = proxy.quaternion.toArray();
      }
    });
  });
  const proposal = createDocumentProposal({
    getFrame,
    evaluate: (environment, blueprint) => {
      const result = loadSave({ ...blueprint, environment });
      if (!result.ok) throw Error(explainFailure(result, blueprint));
      return result.blueprint;
    },
    send: (environment, expectedCursor) =>
      send({ type: 'replace-scene', environment, expectedCursor }),
  });
  const current = () => authoredScene(getFrame().metadata.blueprint.environment);
  function endGesture() {
    if (gizmo.dragging) {
      gizmo.reset();
      gizmo.dragging = false;
    }
    gizmo.axis = null;
    orbit.enabled = true;
  }
  globalThis.window?.addEventListener('blur', endGesture);
  canvas.addEventListener('lostpointercapture', endGesture);

  let hiddenCommitted = null;
  function clearPreview() {
    if (hiddenCommitted) {
      hiddenCommitted.group.visible = hiddenCommitted.visible;
      hiddenCommitted = null;
    }
    if (!dragging) gizmo.detach();
    for (const child of [...preview.children]) {
      child.geometry.dispose();
      child.material.dispose();
      preview.remove(child);
    }
    invalidate();
  }
  function renderPreview() {
    clearPreview();
    const p = proposal.read();
    if (!p) return;
    hiddenCommitted = { group: meshes(), visible: meshes().visible };
    meshes().visible = false;
    try {
      for (const d of sceneObjectDescriptors(p.value)) preview.add(sceneMesh(d, true));
    } catch {}
    const o = p.value.objects.find((o) => o.id === selected);
    if (o && !dragging && tool !== 'select' && !p.stale && p.phase === 'preview') {
      proxy.position.fromArray(o.position);
      proxy.quaternion.fromArray(o.rotation);
      gizmo.setMode(tool);
      gizmo.attach(proxy);
    }
    invalidate();
  }
  function start(value, id = null, preserve = false) {
    if (preserve && proposal.read()) proposal.read().selected = selected;
    selected = id;
    proposal.start(value, { preserve });
    render();
  }
  function enter() {
    if (getFrame().metadata.mode !== 'build' || proposal.read()?.phase === 'committing') return;
    if (active) return;
    active = true;
    left.classList.add('scene-editing');
    rightPanel.classList.add('scene-editing');
    onContext(true);
    onTool?.(tool);
    previousVisibility = [...left.children].filter((n) => n !== palette).map((n) => [n, n.hidden]);
    inspectorVisibility = [...rightPanel.children]
      .filter((n) => n !== inspector)
      .map((n) => [n, n.hidden]);
    render();
  }
  function leave() {
    if (proposal.read()) return;
    active = false;
    left.classList.remove('scene-editing');
    rightPanel.classList.remove('scene-editing');
    palette.hidden = inspector.hidden = true;
    for (const [n, h] of [...previousVisibility, ...inspectorVisibility]) n.hidden = h;
    onContext(false);
    clearPreview();
  }
  function updateDraft(fn) {
    const p = proposal.read();
    if (!p) return;
    const value = structuredClone(p.value);
    fn(value);
    proposal.change(value);
    renderPreview();
    updateStatus();
  }
  const status = el('p'),
    apply = btn('Apply scene', async () => {
      const pending = proposal.commit();
      render();
      await pending;
      if (proposal.read()?.phase === 'accepted') {
        proposal.cancel();
        clearPreview();
      }
      render();
    }),
    cancel = btn('Cancel preview', () => {
      endGesture();
      if (proposal.cancel()) {
        selected = proposal.read()?.selected ?? selected;
        clearPreview();
        render();
        canvas.focus?.();
      }
    }),
    revalidate = btn('Revalidate preview', () => {
      proposal.revalidate();
      render();
    });
  function updateStatus() {
    const p = proposal.read();
    status.textContent = p
      ? p.phase === 'committing'
        ? 'Applying scene · waiting for confirmation'
        : p.stale
          ? 'Workshop changed. Revalidate this preview before applying.'
          : (p.error?.message ??
            p.error?.reasonCode ??
            'Preview · no changes applied. Click the workbench to position the selected object.')
      : 'Select an object or add one. Scene changes use the workshop Undo history.';
    apply.disabled = !p || p.phase !== 'preview' || p.stale || !p.valid;
    cancel.disabled = p?.phase === 'committing';
    revalidate.hidden = !p?.stale;
  }
  function field(label, value, fn, { min, max, step = '0.01' } = {}) {
    const row = el('label', label + ' '),
      input = el('input');
    input.type = typeof value === 'number' ? 'number' : 'text';
    input.value = String(typeof value === 'number' ? Number(value.toFixed(6)) : value);
    input.setAttribute('aria-label', label);
    if (input.type === 'number') {
      input.step = step;
      if (min !== undefined) input.min = String(min);
      if (max !== undefined) input.max = String(max);
    }
    input.onchange = () => fn(input.type === 'number' ? Number(input.value) : input.value);
    input.disabled = proposal.read()?.stale || proposal.read()?.phase === 'committing';
    row.append(input);
    inspector.append(row);
  }
  function render() {
    onBusy(proposal.read()?.phase === 'committing');
    lastKey = JSON.stringify([
      getFrame().metadata.blueprint,
      getFrame().metadata.mode,
      getFrame().cursor,
    ]);
    palette.hidden = inspector.hidden = !active;
    if (!active) return;
    for (const [n] of [...previousVisibility, ...inspectorVisibility]) n.hidden = true;
    palette.replaceChildren(el('h2', 'Editing scene'), btn('Done', leave));
    palette.firstElementChild.nextElementSibling.disabled = !!proposal.read();
    const editable = getFrame().metadata.mode === 'build';
    if (!editable) palette.append(el('p', 'Return to Build to edit this scene.'));
    for (const [kind, label] of [
      ['bump', 'Rounded bump'],
      ['ramp', 'Straight ramp'],
      ['block', 'Platform'],
    ]) {
      const b = btn('Add ' + label, () => {
        const value = current();
        let n = 1;
        while (value.objects.some((o) => o.id === `object-${n}`)) n++;
        const o = createSceneObject(kind, `object-${n}`);
        value.objects.push(o);
        start(value, o.id);
      });
      b.disabled = !editable || !!proposal.read();
      palette.append(b);
    }
    const value = proposal.read()?.value ?? current();
    for (const o of value.objects) {
      const b = btn(o.name, () => start(current(), o.id));
      b.disabled = !editable || !!proposal.read();
      palette.append(b);
    }
    inspector.replaceChildren(el('h2', selected ? 'Scene object' : 'Scene settings'), status);
    if (proposal.read()) {
      const actions = el('div');
      actions.className = 'scene-actions';
      actions.append(apply, cancel, revalidate);
      inspector.append(actions);
    }
    if (!proposal.read() && editable)
      inspector.append(btn('Edit floor contact', () => start(current())));
    const p = proposal.read();
    if (p) {
      const o = p.value.objects.find((o) => o.id === selected);
      if (o) {
        field('Object name', o.name, (v) =>
          updateDraft((s) => (s.objects.find((o) => o.id === selected).name = v)),
        );
        for (let i = 0; i < 3; i++)
          field(
            `Position ${'XYZ'[i]} (m)`,
            o.position[i],
            (v) => updateDraft((s) => (s.objects.find((o) => o.id === selected).position[i] = v)),
            { min: -10, max: 10 },
          );
        for (let i = 0; i < (o.shape === 'cylinder' ? 2 : 3); i++)
          field(
            o.shape === 'cylinder' ? (i ? 'Diameter (m)' : 'Width (m)') : `Size ${'XYZ'[i]} (m)`,
            o.halfExtents[i] * 2,
            (v) =>
              updateDraft((s) => {
                const obj = s.objects.find((o) => o.id === selected);
                obj.halfExtents[i] = v / 2;
                if (obj.shape === 'cylinder' && i === 1) obj.halfExtents[2] = v / 2;
              }),
            { min: 0.01, max: 4 },
          );
        const angles = new THREE.Euler().setFromQuaternion(
          new THREE.Quaternion().fromArray(o.rotation),
          'YXZ',
        );
        for (const axis of ['x', 'y', 'z'])
          field(
            `Rotate ${axis.toUpperCase()} (degrees)`,
            THREE.MathUtils.radToDeg(angles[axis]),
            (v) =>
              updateDraft((s) => {
                const obj = s.objects.find((o) => o.id === selected);
                const e = new THREE.Euler().setFromQuaternion(
                  new THREE.Quaternion().fromArray(obj.rotation),
                  'YXZ',
                );
                e[axis] = THREE.MathUtils.degToRad(v);
                obj.rotation = new THREE.Quaternion().setFromEuler(e).toArray();
              }),
            { step: '1' },
          );
        const material = el('select');
        material.setAttribute('aria-label', 'Scene material');
        for (const key of Object.keys(MATERIALS)) {
          const opt = el('option', key);
          opt.value = key;
          material.append(opt);
        }
        material.value = o.material;
        material.disabled = p.stale || p.phase === 'committing';
        material.onchange = () =>
          updateDraft((s) => (s.objects.find((o) => o.id === selected).material = material.value));
        inspector.append(el('label', 'Material'), material);
        for (const key of ['friction', 'restitution'])
          field(
            key === 'friction' ? 'Grip' : 'Bounce',
            o[key],
            (v) => updateDraft((s) => (s.objects.find((o) => o.id === selected)[key] = v)),
            { min: 0, max: key === 'friction' ? 2 : 1 },
          );
        const duplicate = btn('Duplicate', () => {
          const value = structuredClone(p.value);
          const copy = structuredClone(value.objects.find((o) => o.id === selected));
          let n = 1;
          while (value.objects.some((o) => o.id === `object-${n}`)) n++;
          copy.id = `object-${n}`;
          copy.name += ' copy';
          copy.position[0] += copy.halfExtents[0] * 2 + 0.02;
          value.objects.push(copy);
          selected = copy.id;
          proposal.change(value);
          render();
        });
        const remove = btn('Delete object', () => {
          updateDraft((s) => (s.objects = s.objects.filter((o) => o.id !== selected)));
          selected = null;
          render();
        });
        duplicate.disabled = remove.disabled = p.stale || p.phase === 'committing';
        inspector.append(duplicate, remove);
      } else
        for (const key of ['friction', 'restitution'])
          field(
            key === 'friction' ? 'Floor grip' : 'Floor bounce',
            p.value.ground[key],
            (v) => updateDraft((s) => (s.ground[key] = v)),
            { min: 0, max: key === 'friction' ? 2 : 1 },
          );
    }
    renderPreview();
    updateStatus();
  }
  function openBrowser() {
    if (proposal.read()?.phase === 'committing' || getFrame().metadata.mode !== 'build') return;
    browserScene = null;
    dialog.replaceChildren(
      el('h2', 'Choose scene'),
      el(
        'p',
        'Replace only the scene. Your machine stays in place. Undo restores the previous scene.',
      ),
      btn('Close', () => dialog.close()),
    );
    const list = el('div'),
      detail = el('div');
    dialog.append(list, detail);
    const choose = (name, value) => {
      browserScene = value;
      detail.replaceChildren(
        el('h3', name),
        el('p', `${value.objects.length} fixed objects · floor grip ${value.ground.friction}`),
      );
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-label', 'Scene footprint preview');
      const all = [];
      for (const descriptor of sceneObjectDescriptors(value)) {
        const mesh = sceneMesh(descriptor);
        mesh.updateMatrixWorld(true);
        const positions = mesh.geometry.attributes.position,
          points = [];
        for (let i = 0; i < positions.count; i++) {
          const v = new THREE.Vector3()
            .fromBufferAttribute(positions, i)
            .applyMatrix4(mesh.matrixWorld);
          points.push([v.x, v.z]);
        }
        mesh.geometry.dispose();
        mesh.material.dispose();
        points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const half = (values) => {
          const result = [];
          for (const p of values) {
            while (result.length >= 2 && cross(result.at(-2), result.at(-1), p) <= 0) result.pop();
            result.push(p);
          }
          return result.slice(0, -1);
        };
        const hull = [...half(points), ...half([...points].reverse())];
        all.push(...hull);
        const polygon = document.createElementNS(svg.namespaceURI, 'polygon');
        polygon.setAttribute('points', hull.map((p) => p.join(',')).join(' '));
        polygon.setAttribute('fill', '#c39752');
        polygon.setAttribute('stroke', '#f7d49a');
        polygon.setAttribute('stroke-width', '0.005');
        svg.append(polygon);
      }
      const minX = Math.min(-0.1, ...all.map((p) => p[0])) - 0.1,
        maxX = Math.max(0.1, ...all.map((p) => p[0])) + 0.1,
        minZ = Math.min(-0.1, ...all.map((p) => p[1])) - 0.1,
        maxZ = Math.max(0.1, ...all.map((p) => p[1])) + 0.1;
      svg.setAttribute('viewBox', `${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}`);
      detail.append(
        svg,
        btn('Preview replacement', () => {
          dialog.close();
          if (!active) enter();
          start(browserScene, null, true);
        }),
      );
    };
    for (const [key, label] of [
      ['flat', 'Flat floor'],
      ['bump', 'Bump test'],
      ['hill', 'Hill climb'],
      ['steps', 'Steps'],
    ])
      list.append(btn(label, () => choose(label, sceneLayout(key))));
    try {
      for (const item of library.list()) {
        list.append(
          btn(item.name, () => choose(item.name, item.scene)),
          btn(`Remove saved ${item.name}`, () => {
            try {
              library.remove(item.id);
              dialog.close();
              openBrowser();
            } catch (e) {
              detail.textContent = e.message;
            }
          }),
        );
      }
    } catch (e) {
      list.append(el('p', e.message));
    }
    const name = el('input');
    name.placeholder = 'Scene name';
    name.setAttribute('aria-label', 'Saved scene name');
    dialog.append(
      name,
      btn('Save current scene', () => {
        try {
          library.add(name.value, current());
          dialog.close();
          openBrowser();
        } catch (e) {
          detail.textContent = `${e.message} Export the scene to keep a copy.`;
        }
      }),
      btn('Export scene', () => exportScene({ version: 1, scene: current() })),
    );
    const file = el('input');
    file.type = 'file';
    file.accept = '.json';
    file.setAttribute('aria-label', 'Import scene');
    file.onchange = async () => {
      try {
        const f = file.files[0];
        if (f.size > 1024 * 1024) throw Error('Scene file exceeds 1 MB.');
        const data = JSON.parse(await f.text());
        if (data.version !== 1 || Object.keys(data).sort().join(',') !== 'scene,version')
          throw Error('Unsupported scene file.');
        choose(f.name, authoredScene(data.scene));
      } catch (e) {
        detail.textContent = e.message;
      }
    };
    dialog.append(file);
    dialog.showModal();
  }
  return {
    dialog,
    enter,
    openBrowser,
    frame() {
      const bounds = new THREE.Box3().setFromObject(proposal.read() ? preview : meshes());
      if (bounds.isEmpty()) return;
      const center = bounds.getCenter(new THREE.Vector3()),
        size = bounds.getSize(new THREE.Vector3()),
        direction = camera.position.clone().sub(orbit.target).normalize();
      camera.position.copy(center).addScaledVector(direction, Math.max(size.length() * 2, 1));
      orbit.target.copy(center);
      orbit.update();
      invalidate();
    },
    setTool(value) {
      if (!['select', 'translate', 'rotate'].includes(value)) return;
      tool = value;
      renderPreview();
    },
    documentReplaced() {
      if (proposal.cancel(true)) {
        selected = null;
        clearPreview();
        render();
      }
    },
    read() {
      scene.updateMatrixWorld(true);
      const handles = [];
      gizmo.getHelper().traverseVisible((node) => {
        if (node.isMesh && ['X', 'Y', 'Z'].includes(node.name)) {
          const center = new THREE.Box3()
            .setFromObject(node)
            .getCenter(new THREE.Vector3())
            .project(camera);
          handles.push({ axis: node.name, point: center.toArray() });
        }
      });
      return {
        active,
        selected,
        tool,
        gizmoMode: gizmo.getMode(),
        axis: gizmo.axis,
        dragging,
        committedVisible: meshes().visible,
        preview: preview.children.map((mesh) => ({
          position: mesh.position.toArray(),
          rotation: mesh.quaternion.toArray(),
        })),
        handles,
      };
    },
    active: () => active,
    pending: () => proposal.read()?.phase === 'committing',
    draft: () => !!proposal.read(),
    refresh() {
      proposal.refresh();
      if (proposal.read()?.phase === 'accepted') {
        proposal.cancel();
        clearPreview();
      }
      if (
        active &&
        lastKey !==
          JSON.stringify([
            getFrame().metadata.blueprint,
            getFrame().metadata.mode,
            getFrame().cursor,
          ])
      )
        render();
    },
    point(event) {
      if (
        !active ||
        dragging ||
        gizmo.axis ||
        getFrame().metadata.mode !== 'build' ||
        proposal.read()?.phase === 'committing' ||
        (proposal.read() && tool !== 'select')
      )
        return;
      const rect = canvas.getBoundingClientRect(),
        ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      if (proposal.read() && selected) {
        const point = new THREE.Vector3();
        if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point))
          updateDraft((s) => {
            const o = s.objects.find((o) => o.id === selected);
            o.position[0] = Math.round(point.x * 100) / 100;
            o.position[2] = Math.round(point.z * 100) / 100;
          });
        render();
      } else {
        const hit = ray.intersectObjects(meshes().children).find((h) => h.object.userData.sceneId);
        if (hit) start(current(), hit.object.userData.sceneId);
      }
    },
    key(event) {
      const textInput =
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) ||
        event.target.isContentEditable;
      if (!textInput && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const next = { v: 'select', w: 'translate', e: 'rotate' }[event.key.toLowerCase()];
        if (next) {
          event.preventDefault();
          if (onTool) onTool(next);
          else this.setTool(next);
          return;
        }
      }
      const p = proposal.read();
      if (
        !textInput &&
        !event.ctrlKey &&
        !event.metaKey &&
        p?.phase === 'preview' &&
        !p.stale &&
        selected &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(
          event.key,
        )
      ) {
        event.preventDefault();
        updateDraft((value) => {
          const object = value.objects.find((o) => o.id === selected);
          if (event.altKey) {
            const axis = new THREE.Vector3(0, 1, 0);
            const turn = new THREE.Quaternion().setFromAxisAngle(
              axis,
              ((['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key) ? 1 : -1) * Math.PI) / 2,
            );
            object.rotation = turn
              .multiply(new THREE.Quaternion().fromArray(object.rotation))
              .normalize()
              .toArray();
          } else {
            const forward = camera.getWorldDirection(new THREE.Vector3());
            forward.y = 0;
            if (forward.lengthSq() < 1e-12) forward.set(0, 0, -1);
            forward.normalize();
            const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
            const direction =
              event.key === 'ArrowUp'
                ? forward
                : event.key === 'ArrowDown'
                  ? forward.negate()
                  : event.key === 'ArrowRight'
                    ? right
                    : event.key === 'ArrowLeft'
                      ? right.negate()
                      : new THREE.Vector3(0, event.key === 'PageUp' ? 1 : -1, 0);
            object.position = new THREE.Vector3(...object.position)
              .addScaledVector(direction, 0.025)
              .toArray();
          }
        });
        render();
        canvas.focus?.();
        return;
      }
      if (
        event.key.toLowerCase() === 'f' &&
        !['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)
      ) {
        event.preventDefault();
        this.frame();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        endGesture();
        if (proposal.read()) {
          if (proposal.cancel()) {
            selected = proposal.read()?.selected ?? selected;
            clearPreview();
            render();
          }
        } else leave();
      }
    },
    dispose() {
      endGesture();
      globalThis.window?.removeEventListener('blur', endGesture);
      canvas.removeEventListener('lostpointercapture', endGesture);
      gizmo.dispose();
      scene.remove(proxy, gizmo.getHelper());
      clearPreview();
      scene.remove(preview);
      dialog.remove();
      palette.remove();
      inspector.remove();
    },
  };
}
