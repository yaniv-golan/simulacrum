import test from 'node:test';
import assert from 'node:assert/strict';
import { createThumbnailQueue } from '../src/presentation/thumbnail-queue.mjs';

function fixture(overrides = {}) {
  const pending = new Map(),
    published = [],
    rendered = [],
    errors = [];
  let sequence = 0,
    freed = 0;
  const options = {
    types: ['first', 'loaded-only', 'last'],
    render(type) {
      rendered.push(type);
      return `image:${type}`;
    },
    publish(type, image) {
      published.push([type, image]);
    },
    dispose() {
      freed++;
    },
    onError(error) {
      errors.push(error);
    },
    schedule(callback) {
      const id = ++sequence;
      pending.set(id, callback);
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
    ...overrides,
  };
  const queue = createThumbnailQueue(options);
  return {
    queue,
    pending,
    published,
    rendered,
    errors,
    get freed() {
      return freed;
    },
    step() {
      const [id, callback] = pending.entries().next().value;
      pending.delete(id);
      callback();
    },
  };
}

test('thumbnail work yields before rendering and between types without dropping loaded-only icons', () => {
  const f = fixture();
  assert.deepEqual(f.rendered, [], 'thumbnail startup must yield');
  assert.equal(f.pending.size, 1);
  f.step();
  assert.deepEqual(f.published, [['first', 'image:first']]);
  assert.equal(f.freed, 0, 'shared shader resources must survive between thumbnails');
  // Wrong control: a synchronous all-catalog batch violates the one-turn boundary.
  assert.throws(() => assert.deepEqual(f.rendered, ['first', 'loaded-only', 'last']));
  f.step();
  f.step();
  assert.deepEqual(f.published, [
    ['first', 'image:first'],
    ['loaded-only', 'image:loaded-only'],
    ['last', 'image:last'],
  ]);
  assert.equal(f.freed, 1);
  assert.equal(f.pending.size, 0);
  f.queue.dispose();
  assert.equal(f.freed, 1);
});

test('thumbnail cancellation frees partial resources once and stale callbacks cannot publish', () => {
  for (const started of [false, true]) {
    const f = fixture();
    assert.equal(f.freed, 0, 'the batch must remain cancellable');
    if (started) f.step();
    const stale = [...f.pending.values()][0];
    const before = structuredClone(f.published);
    f.queue.dispose();
    f.queue.dispose();
    stale();
    assert.deepEqual(f.published, before);
    assert.equal(f.freed, 1);
    assert.equal(f.pending.size, 0);
    assert.throws(() => assert.equal(f.freed, 2));
  }
});

test('scheduled thumbnail failures are reported and release the batch without an uncaught callback error', () => {
  for (const stage of ['render', 'publish']) {
    const error = Error(`failed ${stage}`);
    let f;
    assert.doesNotThrow(() => {
      f = fixture({
        [stage]() {
          throw error;
        },
      });
    }, 'creation must defer rendering failures');
    assert.doesNotThrow(() => f.step());
    assert.deepEqual(f.errors, [error]);
    assert.equal(f.freed, 1);
    assert.equal(f.pending.size, 0);
    f.queue.dispose();
    assert.equal(f.freed, 1);
  }
});
