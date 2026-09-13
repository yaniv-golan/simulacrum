import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
// Compared packages declare different backend identities in the snapshot envelope.
// Normalize that field (and its envelope checksum), retaining every native byte.
export const hashNativeState = (x) => {
  const normalized = structuredClone(x),
    cp = normalized.checkpoint ?? normalized;
  if (Array.isArray(cp.physics)) {
    const bytes = Uint8Array.from(cp.physics),
      view = new DataView(bytes.buffer),
      size = view.getUint32(4);
    const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + size)));
    assert.match(meta.backend, /^0\.20\.0-simulacrum\.spring\.(?:[6789]|10)\.f64$/);
    meta.backend = '0.20.0-simulacrum.spring.6.f64';
    const encoded = new TextEncoder().encode(JSON.stringify(meta));
    const normalizedBytes = new Uint8Array(12 + encoded.length + bytes.length - 12 - size),
      normalizedView = new DataView(normalizedBytes.buffer);
    normalizedBytes.set(bytes.subarray(0, 12));
    normalizedView.setUint32(4, encoded.length);
    normalizedBytes.set(encoded, 12);
    normalizedBytes.set(bytes.subarray(12 + size), 12 + encoded.length);
    let h = 2166136261;
    for (const byte of normalizedBytes.subarray(12)) h = Math.imul(h ^ byte, 16777619);
    normalizedView.setUint32(8, h >>> 0);
    cp.physics = Array.from(normalizedBytes);
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
};
export async function probeNativeState(output, expectedFile) {
  const { createSession } = await import('../src/simulation/session.mjs');
  const { compileAssembly } = await import('../src/model/assembly.mjs');
  const { createPoweredSuspensionCart } = await import(
    '../src/model/fixtures/guided-suspension.mjs'
  );
  const { createActiveSuspensionBench } = await import(
    '../src/model/fixtures/articulated-suspension.mjs'
  );
  const { createSpringLauncher } = await import('../src/model/fixtures/spring-launcher.mjs');
  const expected = expectedFile ? JSON.parse(readFileSync(expectedFile)) : null;
  const results = [];
  for (const [name, factory, ticks] of [
    ['guided', createPoweredSuspensionCart, 480],
    ['active', createActiveSuspensionBench, 480],
    ['launcher', createSpringLauncher, 360],
  ])
    for (const turn of [false, true]) {
      const bp = factory();
      if (turn)
        for (const p of bp.parts) {
          const [x, y, z, w] = p.rotation;
          p.rotation = [z, w, -x, -y];
          p.position = [-p.position[0], p.position[1], -p.position[2]];
        }
      const { configuration } = compileAssembly(bp);
      const session = await createSession(configuration);
      const hashes = [];
      try {
        for (let tick = 1; tick <= ticks; tick++) {
          if (name === 'guided' && tick === 1)
            session.act({
              type: 'receiver',
              node: bp.parts.findIndex((p) => p.id === 'receiver'),
              duty: 0.1,
            });
          if (name === 'launcher' && tick === 241)
            session.act({
              type: 'receiver',
              node: bp.parts.findIndex((p) => p.id === 'release'),
              duty: 1,
            });
          try {
            session.step();
          } catch (error) {
            writeFileSync(
              output,
              JSON.stringify({
                failureKind: 'native-step',
                name,
                turn,
                tick,
                error: error.message,
              }),
            );
            throw error;
          }
          const o = session.observe().frames[0];
          assert.equal(o.status, 'ready');
          const checkpoint = session.checkpoint();
          hashes.push(
            hashNativeState({
              checkpoint,
              physics: o.physics,
              contacts: o.contacts,
              springs: o.springs,
            }),
          );
          if (
            expected &&
            hashes.at(-1) !==
              expected.find((x) => x.name === name && x.turn === turn).hashes[tick - 1]
          ) {
            writeFileSync(
              output,
              JSON.stringify({ failureKind: 'state-mismatch', name, turn, tick }),
            );
            throw Error('Native state mismatch');
          }
          if (tick === Math.floor(ticks / 2)) {
            session.step();
            const next = hashNativeState(session.checkpoint());
            session.restore(checkpoint);
            session.step();
            assert.equal(
              hashNativeState(session.checkpoint()),
              next,
              'cold restore changes next complete native state',
            );
            session.restore(checkpoint);
          }
        }
        results.push({ name, turn, ticks, hashes });
        writeFileSync(output, JSON.stringify(results));
      } finally {
        try {
          session.dispose();
        } catch (error) {
          console.error('cleanup after native failure:', error.message);
        }
      }
      console.log(name, turn, hashes.at(-1));
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await probeNativeState(process.argv[2], process.argv[3]);
