import { createPrimitiveGeometry } from './primitive-geometry.mjs';
import * as THREE from 'three';
import { reviewTimeline, seekReview, sceneParts, safeMedia } from './capture-review-model.mjs';
export function mountCaptureReview(data, index) {
  const timeline = reviewTimeline(index),
    $ = (id) => document.getElementById(id);
  $('status').textContent =
    `Stream: ${timeline.status}. ${timeline.gaps.length} recorded gap(s). ${index.error ?? ''} ${data.legacyProvenance ? 'Legacy export: raw-event provenance unavailable.' : ''}`;
  $('timeline').textContent = JSON.stringify(
    { gaps: timeline.gaps, events: timeline.events },
    null,
    2,
  );
  let renderer = null,
    scene,
    camera,
    group;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(900, 500);
    $('scene').append(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#192c35');
    camera = new THREE.PerspectiveCamera(45, 1.8, 0.01, 1e5);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x34424b, 3));
    scene.add(new THREE.GridHelper(20, 40));
    group = new THREE.Group();
    scene.add(group);
  } catch {
    $('unsupported').textContent =
      '3D preview unavailable in this browser. Recorded state remains available below.';
  }
  let renderedEvent, selectedPrevious, selectedDecoded;
  function show(time) {
    const selected = seekReview(timeline, time);
    if (selected !== selectedPrevious) {
      selectedDecoded = selected ? index.readEvent(timeline.events.indexOf(selected)) : null;
      selectedPrevious = selected;
    }
    const event = selectedDecoded;
    $('seek').value = time;
    $('time').textContent =
      `${(time / 1000).toFixed(2)} s; observed sample ${event ? (event.timeMs / 1000).toFixed(2) + ' s' : 'unavailable'}`;
    $('context').textContent = JSON.stringify(event?.context ?? null, null, 2);
    if (!renderer || event === renderedEvent) return;
    renderedEvent = event;
    for (const object of [...group.children]) {
      object.geometry?.dispose();
      object.material?.dispose();
      group.remove(object);
    }
    if (!event) {
      renderer.render(scene, camera);
      return;
    }
    try {
      const parts = sceneParts(event.context.observation);
      for (const part of parts)
        for (const primitive of part.primitives) {
          const geometry = createPrimitiveGeometry(primitive);
          const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: 0xb1cad7, wireframe: false }),
          );
          mesh.position.fromArray(part.position);
          mesh.quaternion.fromArray(part.rotation);
          group.add(mesh);
        }
      const recorded = event.context.ui?.camera;
      const finite3 = (v) =>
        Array.isArray(v) &&
        v.length === 3 &&
        v.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e6);
      if (finite3(recorded?.position) && finite3(recorded?.target)) {
        camera.position.fromArray(recorded.position);
        camera.lookAt(...recorded.target);
        camera.fov = Number.isFinite(recorded.fov) ? Math.max(10, Math.min(120, recorded.fov)) : 45;
      } else {
        const box = new THREE.Box3().setFromObject(group),
          center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3()),
          size = box.isEmpty() ? 1 : Math.max(1, box.getSize(new THREE.Vector3()).length());
        camera.position.copy(center).add(new THREE.Vector3(size, size, size));
        camera.lookAt(center);
      }
      camera.updateProjectionMatrix();
      $('unsupported').textContent =
        'Geometry approximation: authored primitives and recorded poses. Materials, wires, overlays and UI layout are not reconstructed.';
    } catch (error) {
      $('unsupported').textContent = 'Unsupported recorded scene: ' + error.message;
    }
    renderer.render(scene, camera);
  }
  $('seek').max = timeline.duration;
  $('seek').oninput = () => show(Number($('seek').value));
  let playing = false,
    last = 0;
  $('play').onclick = () => {
    playing = !playing;
    $('play').textContent = playing ? 'Pause' : 'Play';
    last = performance.now();
  };
  function animate(now) {
    if (playing) {
      const t = Math.min(timeline.duration, Number($('seek').value) + now - last);
      show(t);
      if (t >= timeline.duration) {
        playing = false;
        $('play').textContent = 'Play';
      }
    }
    last = now;
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  const screen = data.media.find((m) => m.kind === 'screen' && safeMedia(m.file));
  if (screen) {
    $('screen').src = screen.file;
    $('screen').hidden = false;
  } else $('video-note').textContent = 'No tab video recorded.';
  for (const event of timeline.events.filter((e) =>
    ['feedback-text', 'voice-start'].includes(e.kind),
  )) {
    const anchor = timeline.events.find(
        (a) => a.kind === 'feedback-anchor' && a.data?.id === event.data?.anchorId,
      ),
      time = anchor?.timeMs ?? event.timeMs;
    const row = document.createElement('section'),
      button = document.createElement('button');
    button.textContent = `${(time / 1000).toFixed(1)} s — ${event.kind === 'feedback-text' ? (event.data?.text ?? 'Unavailable feedback text') : 'Voice comment'}`;
    button.onclick = () => {
      show(time);
      if (screen) $('screen').currentTime = time / 1000;
    };
    row.append(button);
    const clip = data.media.find(
      (m) => m.kind === 'voice' && m.clip === event.data?.clip && safeMedia(m.file),
    );
    if (event.kind === 'voice-start' && clip) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = clip.file;
      row.append(audio);
    }
    const shot = anchor?.data?.image;
    if (
      typeof shot === 'string' &&
      shot.length <= 2 * 1024 * 1024 &&
      /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(shot)
    ) {
      const img = document.createElement('img');
      img.src = shot;
      img.alt = 'Feedback screenshot: ' + (anchor?.data?.imageScope ?? 'legacy coverage unknown');
      row.append(img);
    }
    if (anchor?.data?.imageError) {
      const p = document.createElement('p');
      p.textContent = 'Screenshot unavailable: ' + anchor.data.imageError;
      row.append(p);
    }
    $('comments').append(row);
  }
  for (const media of data.media.filter((m) => m.gaps)) {
    const p = document.createElement('p');
    p.textContent = 'Incomplete media: ' + media.file;
    $('status').append(p);
  }
  show(0);
}
