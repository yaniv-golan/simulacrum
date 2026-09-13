import { createCameraRenderer } from '../src/presentation/camera-renderer.mjs';
import { createCameraGallery } from '../src/application/camera-gallery.mjs';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
/** Bundled by the browser check from the candidate's production modules. */
export async function cameraOpticalProbe() {
  const check = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const camera = { type: 'camera', parameters: {}, authoredMaterial: {} };
  const target = { type: 'spacerBlock', parameters: {}, authoredMaterial: { body: 'rubber' } };
  const body = (position, rotation = [0, 0, 0, 1]) => ({ position, rotation });
  const frame = {
    tick: 12,
    blueprint: { environment: 'flat', parts: [camera, target] },
    physics: [body([0, 2, 0]), body([0.2, 2, 1])],
  };
  let context;
  const textures = [],
    buffers = [];
  const adapter = createCameraRenderer({
    onContext(value) {
      context = value;
      for (const [method, handles] of [
        ['createTexture', textures],
        ['createBuffer', buffers],
      ]) {
        const create = context[method].bind(context);
        context[method] = (...args) => {
          const handle = create(...args);
          handles.push(handle);
          return handle;
        };
      }
    },
  });
  const image = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    canvas.getContext('2d').drawImage(adapter.render(frame, 0), 0, 0);
    return canvas.getContext('2d').getImageData(0, 0, 320, 240).data;
  };
  const darkCenter = () => {
    const d = image();
    let x = 0,
      y = 0,
      n = 0;
    for (let i = 0; i < 76800; i++)
      if (d[i * 4] < 90 && d[i * 4 + 1] < 90 && d[i * 4 + 2] < 90) {
        x += i % 320;
        y += Math.floor(i / 320);
        n++;
      }
    return { x: x / n, y: y / n, n };
  };
  const before = darkCenter();
  const projected = 160 - ((160 / Math.tan(Math.PI / 6)) * 0.2) / (1 - 0.020001);
  check(
    before.n > 20 && Math.abs(before.x + 0.5 - projected) < 2,
    'independent projected target center',
  );
  check(
    Math.abs(before.x + 0.5 - (320 - projected)) > 40,
    'reversed screen-right negative control',
  );
  const pixels = image();
  frame.blueprint.parts.forEach((p, i) => {
    p.id = 'renamed-' + i;
    p.name = 'arbitrary';
  });
  frame.editor = { outlines: true, exploded: 100 };
  check(
    image().every((v, i) => v === pixels[i]),
    'identity and editor fields cannot change optical pixels',
  );
  frame.physics[1] = body([0.2, 2, -1]);
  check(darkCenter().n === 0, 'rear target must not enter image');
  frame.physics[1] = body([0.2, 2, 1]);
  const shape = {
    shape: 'box',
    rotation: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    mass: 0.2592,
    fixed: false,
    halfExtents: [0.03, 0.02, 0.02],
    friction: 0,
    restitution: 0,
  };
  const hinge = await createPhysicsWorld({
    gravity: [0, 0, 0],
    bodies: [
      { ...shape, position: [0, 2, 0] },
      { ...shape, position: [0, 1.9, 0], fixed: true },
    ],
    joints: [
      {
        kind: 'revolute',
        a: 1,
        b: 0,
        anchorA: [0, 0.1, 0],
        anchorB: [0, 0, 0],
        axisA: [0, 1, 0],
        axisB: [0, 1, 0],
      },
    ],
  });
  try {
    for (let i = 0; i < 36; i++) {
      hinge.applyTorquePair(1, 0, [0, 1, 0], 0.00075);
      hinge.step();
    }
    const pose = hinge.read()[0];
    frame.physics[0] = body(pose.position, pose.rotation);
  } finally {
    hinge.dispose();
  }
  const turned = darkCenter();
  check(turned.n > 0 && turned.x > before.x + 40, 'rotated optical body changes projected target');
  frame.physics[0] = body([0, 2, 0]);
  const timings = [];
  let made = 0,
    revoked = 0;
  const gallery = createCameraGallery({
    encode: (packet) => adapter.encode(packet),
    createURL: (blob) => {
      made++;
      return URL.createObjectURL(blob);
    },
    revokeURL: (url) => {
      revoked++;
      URL.revokeObjectURL(url);
    },
  });
  try {
    for (let i = 0; i < 100; i++) {
      frame.tick = 12 * (i + 1);
      check(
        await gallery.capture({
          frame: structuredClone(frame),
          node: 0,
          metadata: { captureTick: frame.tick },
        }),
        'capture within capacity',
      );
      timings.push(adapter.read().encoding);
    }
    check(!(await gallery.capture({ frame, node: 0, metadata: {} })), '101st photo rejected');
    check(gallery.read().photos.length === 100, 'no eviction');
    check(
      timings.every((t) => t && t.copyMs >= 0 && t.completionMs >= 0),
      'separate synchronous copy and PNG completion measurements',
    );
    const retainedBytes = gallery.read().bytes;
    gallery.clear();
    check(made === revoked, 'all URLs revoked on clear');
    const eight = {
      tick: frame.tick,
      blueprint: {
        environment: 'flat',
        parts: Array.from({ length: 8 }, () => structuredClone(camera)),
      },
      physics: Array.from({ length: 8 }, (_, i) => body([i * 0.1, 2, 0])),
    };
    const pending = gallery.capture({ frame: eight, node: 0, metadata: { cameraId: 'camera-0' } });
    const contenders = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        gallery.capture({ frame: eight, node: i + 1, metadata: { cameraId: `camera-${i + 1}` } }),
      ),
    );
    check(
      contenders.every((v) => !v),
      'eight-camera destination contention admits one encoder',
    );
    check(await pending, 'first camera owns the encoder reservation');
    for (let cycle = 0; cycle < 10; cycle++) {
      gallery.epoch(String(cycle));
      gallery.clear();
      await gallery.capture({ frame, node: 0, metadata: {} });
    }
    const resources = adapter.read().resources;
    check(resources.geometries <= 4 && resources.textures <= 2, 'bounded optical resources');
    const lost = new Promise((r) =>
      context.canvas.addEventListener('webglcontextlost', r, { once: true }),
    );
    const contextControl = context.getExtension('WEBGL_lose_context');
    contextControl.loseContext();
    await lost;
    let rejected = false;
    try {
      adapter.render(frame, 0);
    } catch (e) {
      rejected = /context lost/i.test(e.message);
    }
    check(rejected, 'context loss cannot publish a fresh frame');
    const restored = new Promise((resolve) =>
      context.canvas.addEventListener('webglcontextrestored', resolve, { once: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    contextControl.restoreContext();
    await restored;
    frame.tick += 12;
    adapter.render(frame, 0);
    check(
      adapter.read().tick === frame.tick && !context.isContextLost(),
      'restored context publishes a newly completed frame',
    );
    gallery.dispose();
    adapter.dispose();
    const disposedResources = adapter.read().resources;
    const liveHandles = {
      textures: textures.filter((h) => context.isTexture(h)).length,
      buffers: buffers.filter((h) => context.isBuffer(h)).length,
    };
    check(
      disposedResources.geometries === 0 &&
        context.isContextLost() &&
        liveHandles.textures === 0 &&
        liveHandles.buffers === 0,
      'disposal invalidates owned GL resources and context',
    );
    for (let cycle = 0; cycle < 10; cycle++) {
      const temporary = createCameraRenderer();
      temporary.render(frame, 0);
      temporary.dispose();
      check(temporary.read().resources.geometries === 0, 'repeated view/reset disposal');
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return {
      disposedResources,
      liveHandles,
      projected,
      before,
      turned,
      timings,
      resources,
      retainedBytes,
      capacityPhotos: 100,
      contention: { cameras: 8, accepted: 1, rejected: 7 },
      contextRestored: true,
      urls: { made, revoked },
      contextLossRejected: rejected,
    };
  } finally {
    gallery.dispose();
    adapter.dispose();
  }
}
