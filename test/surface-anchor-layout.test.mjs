import test from 'node:test';
import assert from 'node:assert/strict';
import { spreadSurfaceAnchors } from '../src/presentation/surface-anchor-layout.mjs';
test('thin and edge-on faces keep every alignment target separately clickable', () => {
  for (const points of [
    [
      { x: 200, y: 200 },
      { x: 199, y: 200 },
      { x: 201, y: 200 },
      { x: 200, y: 120 },
      { x: 200, y: 280 },
    ],
    Array.from({ length: 5 }, () => ({ x: 30, y: 30 })),
  ]) {
    const before = structuredClone(points),
      placed = spreadSurfaceAnchors(points, 400, 400);
    assert.deepEqual(points, before);
    for (let i = 0; i < placed.length; i++)
      for (let j = 0; j < i; j++)
        assert.ok(
          Math.abs(placed[i].x - placed[j].x) >= 30 || Math.abs(placed[i].y - placed[j].y) >= 30,
        );
    assert.ok(placed.every((p) => p.x >= 16 && p.y >= 16 && p.x <= 384 && p.y <= 384));
  }
  const spaced = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 300, y: 100 },
  ];
  assert.deepEqual(spreadSurfaceAnchors(spaced, 400, 400), spaced);
});
