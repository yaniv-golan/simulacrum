import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../src/model/catalog.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { starterSteps } from '../src/application/starter-guide.mjs';
const empty = () => createEmptyBlueprint('mine', 'My machine');
const place = (bp, type, id) => bp.parts.push(createPart(type, id, [0, 0.2, 0]));
// Apply a step's commands the way the workshop would, without the editor.
function apply(bp, commands) {
  for (const command of commands) {
    if (command.type === 'insert') bp.parts.push(command.part);
    else {
      const part = bp.parts.find((p) => p.id === command.a.part);
      const kind = command.a.surface
        ? 'fixed'
        : CATALOG[part.type].ports.find((p) => p.id === command.a.port).kind;
      bp.connections.push({ id: command.id, kind, a: command.a, b: command.b });
    }
  }
}
const step = (label) => starterSteps().find((s) => s.label === label);
test('a player-placed part of the step type satisfies the step wherever it sits', () => {
  const bp = empty();
  place(bp, 'poweredMotor', 'my-motor');
  assert.equal(step('Place Motor').done(bp), true);
  assert.equal(step('Place Chassis').done(bp), false, 'another type does not count');
  place(bp, 'gripWheel', 'w1');
  place(bp, 'gripWheel', 'w2');
  assert.equal(step('Place Drive wheel').done(bp), true);
  assert.equal(step('Place Front wheel').done(bp), true);
  assert.equal(step('Place Rear wheel').done(bp), false, 'three wheels need three wheels');
});
test('a connection step counts kind and part types; Do it for me wires the player parts', () => {
  const bp = empty();
  for (const [type, id] of [
    ['chassis', 'my-frame'],
    ['poweredMotor', 'my-motor'],
    ['powerCell', 'my-cell'],
    ['gripWheel', 'w1'],
    ['passiveBearing', 'b1'],
    ['gripWheel', 'w2'],
    ['passiveBearing', 'b2'],
    ['gripWheel', 'w3'],
  ])
    place(bp, type, id);
  assert.ok(starterSteps().every((s) => s.part === undefined || s.done(bp)));
  const attach = step('Attach Chassis → Motor');
  assert.equal(attach.done(bp), false);
  bp.connections.push({
    id: 'wrong',
    kind: 'shaft',
    a: { part: 'my-motor', port: 'shaft' },
    b: { part: 'b1', port: 'shaft' },
  });
  assert.equal(step('Attach Motor → Drive wheel').done(bp), false, 'a bearing is not a wheel');
  assert.equal(attach.done(bp), false, 'a shaft is not a mount');
  const [command] = attach.commands(bp);
  assert.equal(command.type, 'connect');
  assert.deepEqual([command.a.part, command.b.part], ['my-frame', 'my-motor']);
  apply(bp, [command]);
  assert.equal(attach.done(bp), true);
  const rear = step('Attach Rear bearing → Rear wheel');
  assert.deepEqual(
    rear.commands(bp).map((c) => [c.a.part, c.b.part]),
    [['b2', 'w3']],
    'the second bearing and the third wheel stand in for the vehicle parts',
  );
});
test('the guide can still perform every step itself and never reuses an id', () => {
  const bp = empty();
  const steps = starterSteps();
  for (const s of steps) {
    assert.equal(s.done(bp), false);
    apply(bp, s.commands(bp));
    assert.equal(s.done(bp), true, s.label);
  }
  assert.equal(steps.filter((s) => s.done(bp)).length, steps.length);
  const again = step('Place Motor').commands(bp)[0].part.id;
  assert.notEqual(again, 'guide-motor');
  assert.ok(!bp.parts.some((p) => p.id === again));
});
