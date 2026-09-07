import assert from 'node:assert/strict';
const snapshot = (workshop) => structuredClone(workshop.observe());
const blueprint = (observation) => observation.frames[0].metadata.blueprint;
/** Runtime v1: accepted state-changing edits publish a newer revision; rename does not rebuild. */
async function accepted(workshop, command) {
  const before = snapshot(workshop);
  assert.equal((await workshop.act(command)).ok, true, JSON.stringify(command));
  const after = snapshot(workshop);
  assert.equal(after.cursor.session, before.cursor.session, 'editing keeps observation session');
  assert.ok(after.cursor.revision > before.cursor.revision, 'accepted edit must advance revision');
  assert.ok(after.cursor.epoch >= before.cursor.epoch, 'editing cannot rewind epoch');
  if (command.type === 'rename') {
    assert.equal(
      after.cursor.epoch,
      before.cursor.epoch,
      'rename does not rebuild physical session',
    );
    assert.equal(after.cursor.tick, before.cursor.tick, 'rename does not step physics');
  }
  if (command.type === 'load') {
    assert.ok(
      after.cursor.epoch > before.cursor.epoch,
      'load replaces configuration with a fresh epoch',
    );
    assert.deepEqual(
      after.frames[0].metadata.editing,
      { undoCount: 0, redoCount: 0 },
      'load clears editor history',
    );
  }
  return after;
}
/** Public transaction oracle: no private history or engine objects are inspected. */
export async function assertRejectedEditUnchanged(workshop, command) {
  const before = snapshot(workshop);
  const result = await workshop.act(command);
  assert.equal(result.ok, false, 'wrong command must be rejected');
  assert.deepEqual(
    workshop.observe(),
    before,
    'rejection must preserve observation, cursor and history',
  );
}
export async function assertNoOpEditUnchanged(workshop, command) {
  const before = snapshot(workshop);
  assert.equal((await workshop.act(command)).ok, true, 'no-op is accepted');
  assert.deepEqual(
    workshop.observe(),
    before,
    'no-op must preserve observation, cursor and history',
  );
}
export async function assertEditRoundTrip(workshop, command) {
  const before = blueprint(snapshot(workshop));
  const after = blueprint(await accepted(workshop, command));
  assert.notDeepEqual(after, before, 'fixture must exercise a real edit');
  assert.deepEqual(
    blueprint(await accepted(workshop, { type: 'undo' })),
    before,
    'undo restores authored values',
  );
  assert.deepEqual(
    blueprint(await accepted(workshop, { type: 'redo' })),
    after,
    'redo restores authored values',
  );
  assert.deepEqual(
    blueprint(await accepted(workshop, { type: 'load', save: after })),
    after,
    'save/load preserves authored values',
  );
}
/** Accumulate history before undoing; reload only after every heterogeneous edit has been replayed. */
export async function assertAccumulatedEditHistory(workshop, commands) {
  const states = [blueprint(snapshot(workshop))];
  const checkConnections = () =>
    assert.ok(
      workshop.observe().frames[0].metadata.connections.every((c) => c.reasonCode === 'OK'),
      'every intermediate connection remains admitted',
    );
  for (const command of commands) {
    const next = blueprint(await accepted(workshop, command));
    assert.notDeepEqual(next, states.at(-1), 'sequence fixture must change authored state');
    states.push(next);
    checkConnections();
  }
  for (let i = states.length - 2; i >= 0; i--) {
    assert.deepEqual(
      blueprint(await accepted(workshop, { type: 'undo' })),
      states[i],
      'undo must restore each preceding mixed state',
    );
    checkConnections();
  }
  for (let i = 1; i < states.length; i++) {
    assert.deepEqual(
      blueprint(await accepted(workshop, { type: 'redo' })),
      states[i],
      'redo must replay each mixed state',
    );
    checkConnections();
  }
  assert.deepEqual(
    blueprint(await accepted(workshop, { type: 'load', save: states.at(-1) })),
    states.at(-1),
  );
  checkConnections();
}
