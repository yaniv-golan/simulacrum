import { immutableCopy } from '../model/observation.mjs';
import { CAMERA } from '../model/camera.mjs';
import { createCameraGallery } from './camera-gallery.mjs';
import { createCameraRenderer } from '../presentation/camera-renderer.mjs';
/** Browser destinations consume completed frames. Image results never enter the plant. */
export function createCameraSession({
  send,
  observe,
  buildId,
  sourceIdentity = { head: null, workingTreeDigest: null },
  changed = () => {},
  createRenderer = createCameraRenderer,
  createCanvas = () => document.createElement('canvas'),
}) {
  const provenance = immutableCopy(sourceIdentity);
  let adapter = null,
    active = null,
    epoch = '',
    lastLive = -1,
    lastFrame = null,
    liveFrame = null,
    status = 'Select a camera.',
    captureStatus = '',
    requestId = 0,
    busyRejected = 0,
    seen = new Map(),
    busySeen = new Map(),
    disposed = false;
  const display = createCanvas();
  display.width = CAMERA.width;
  display.height = CAMERA.height;
  const renderer = () => (adapter ??= createRenderer());
  const opticalInput = (frame) =>
    immutableCopy({
      tick: frame.tick,
      blueprint: {
        environment: frame.metadata.blueprint.environment ?? 'flat',
        parts: frame.metadata.blueprint.parts.map(({ type, parameters, authoredMaterial }) => ({
          type,
          parameters: parameters ?? {},
          authoredMaterial: authoredMaterial ?? {},
        })),
      },
      physics: frame.physics.map(({ position, rotation }) => ({ position, rotation })),
    });

  const gallery = createCameraGallery({
    encode: (packet) => renderer().encode({ frame: opticalInput(packet.frame), node: packet.node }),
    onChange: changed,
  });
  const key = (c) => `${c.session}:${c.epoch}`;
  const blank = () => display.getContext('2d')?.clearRect(0, 0, CAMERA.width, CAMERA.height);
  const show = (frame, node) => {
    display.getContext('2d').drawImage(renderer().render(opticalInput(frame), node), 0, 0);
  };
  function capture(frame, node, cursor, id, source) {
    const part = frame.metadata.blueprint.parts[node];
    return gallery.capture({
      frame,
      node,
      metadata: {
        version: CAMERA.version,
        cameraId: part.id,
        requestId: id,
        source,
        session: cursor.session,
        epoch: cursor.epoch,
        captureTick: frame.tick,
        timeSeconds: frame.tick / 120,
        width: CAMERA.width,
        height: CAMERA.height,
        horizontalFov: CAMERA.horizontalFov,
        near: CAMERA.near,
        far: CAMERA.far,
        format: 'image/png',
        build: buildId,
        sourceIdentity: provenance,
        status: 'ok',
      },
    });
  }
  function ingest(observation) {
    if (disposed) return;
    const nextEpoch = key(observation.cursor);
    if (nextEpoch !== epoch) {
      epoch = nextEpoch;
      gallery.epoch(epoch);
      lastLive = -1;
      liveFrame = null;
      seen.clear();
      busySeen.clear();
      blank();
    }
    for (const frame of observation.frames ?? (observation.frame ? [observation.frame] : [])) {
      lastFrame = frame;
      if (!frame.metadata.blueprint.parts.some((p) => p.type === 'camera')) {
        const wasActive = active;
        active = null;
        adapter?.dispose();
        adapter = null;
        if (wasActive) changed();
      }
      for (const row of frame.cameras ?? []) {
        if (observation.ok && row.busySerial > (busySeen.get(row.node) ?? 0))
          busyRejected += row.busySerial - (busySeen.get(row.node) ?? 0);
        busySeen.set(row.node, row.busySerial);
        const prior = seen.get(row.node) ?? 0;
        seen.set(row.node, row.serial);
        if (row.serial <= prior || !row.result) continue;
        // Restored/expired observation windows carry history, not new capture events.
        if (!observation.ok) {
          captureStatus =
            'Historical photo requests were not repeated after restore or missing history.';
          continue;
        }
        if (row.result.tick !== frame.tick) {
          captureStatus = 'Capture history unavailable. Earlier photographs remain in Photos.';
          continue;
        }
        if (frame.metadata.mode === 'build') continue;
        if (row.result.status !== 'ok') {
          captureStatus = `Photo unavailable: ${row.result.status}.`;
          continue;
        }
        captureStatus = '';
        capture(
          frame,
          row.node,
          observation.cursor,
          row.result.source === 'manual' ? row.result.id : `signal-${row.serial}`,
          row.result.source,
        );
      }
      const node = frame.metadata.blueprint.parts.findIndex(
        (p) => p.id === active && p.type === 'camera',
      );
      if (node < 0) {
        active = null;
        continue;
      }
      const row = frame.cameras?.find((r) => r.node === node);
      if (frame.metadata.mode === 'build') {
        status = 'Placement preview — no simulated power';
        try {
          show(frame, node);
        } catch {
          status = 'Camera renderer unavailable';
        }
        continue;
      }
      if (frame.status === 'failed') {
        status = 'Run failed — return to Build and retry.';
        continue;
      }
      if (!row?.powered) {
        status = `No power — check the camera Power wire and cell.${lastLive >= 0 ? ` Image from tick ${lastLive}.` : ''}`;
        continue;
      }
      if (row.sampleTick === frame.tick && frame.tick !== lastLive) {
        try {
          show(frame, node);
          lastLive = frame.tick;
          liveFrame = { frame, node, cursor: observation.cursor };
          status =
            frame.metadata.mode === 'paused'
              ? `Paused · image from tick ${frame.tick}`
              : `Live · tick ${frame.tick}`;
        } catch {
          status = 'Camera renderer unavailable';
        }
      } else if (lastLive < 0) status = 'Camera initializing…';
      else if (frame.metadata.mode === 'paused') status = `Paused · image from tick ${lastLive}`;
      else if (frame.tick - lastLive > CAMERA.period * 2)
        status = `Stale · image from tick ${lastLive}`;
    }
    if (active || adapter || captureStatus || gallery.read().photos.length) changed();
  }
  return Object.freeze({
    ingest,
    watch(id) {
      active = id;
      lastLive = -1;
      liveFrame = null;
      blank();
      if (id) {
        const o = observe();
        ingest({ ...o, ok: false });
      }
      changed();
    },
    async photo(id = active) {
      const o = observe(),
        frame = o.frames[0],
        node = frame.metadata.blueprint.parts.findIndex((p) => p.id === id && p.type === 'camera');
      if (node < 0) return;
      requestId =
        Math.max(requestId, frame.cameras?.find((r) => r.node === node)?.manualId ?? 0) + 1;
      if (frame.metadata.mode === 'paused' && liveFrame && liveFrame.node === node) {
        await capture(
          liveFrame.frame,
          node,
          liveFrame.cursor,
          `paused-${requestId}`,
          'paused-frame',
        );
        return;
      }
      if (frame.metadata.mode !== 'run') {
        captureStatus =
          'Run the machine to take a new photo. Existing photos can be saved while paused.';
        changed();
        return;
      }
      const reply = await send({ type: 'camera-photo', id, requestId, epoch: o.cursor.epoch });
      captureStatus = reply.ok
        ? 'Photo requested for the next completed sample.'
        : `Photo request failed: ${reply.reasonCode}`;
      changed();
    },
    read() {
      return {
        active,
        status,
        captureStatus:
          captureStatus +
          (busyRejected
            ? ` ${busyRejected} photo triggers were rejected as busy. Clear photos to dismiss this count.`
            : ''),
        frame: lastFrame,
        live: lastLive,
        canPhoto:
          lastFrame?.metadata.mode === 'run' ||
          (lastFrame?.metadata.mode === 'paused' && !!liveFrame),
        gallery: gallery.read(),
        render: adapter?.read() ?? null,
      };
    },
    canvas() {
      return adapter ? display : null;
    },
    clear() {
      captureStatus = '';
      busyRejected = 0;
      gallery.clear();
    },
    dispose() {
      disposed = true;
      gallery.dispose();
      adapter?.dispose();
      adapter = null;
      display.remove?.();
    },
  });
}
