import assert from 'node:assert/strict';

const sorted = (items) => [...items].sort();
const authored = ({ id, name, position, rotation, ...fields }) => fields;
function index(records, label) {
  const result = new Map(records.map((record) => [record.id, record]));
  assert.equal(result.size, records.length, `${label}: duplicate IDs`);
  return result;
}
function references(value, found = new Set()) {
  if (value && typeof value === 'object' && !found.has(value)) {
    found.add(value);
    for (const child of Object.values(value)) references(child, found);
  }
  return found;
}

/** Checks copied graph facts, without deciding selection, placement or crossing-edge policy.
 * `allowedExternalConnectionIds` explicitly permits caller-verified crossing edges
 * (e.g. mirror reference mounts). Their geometry remains the caller's assertion.
 */
export function assertCopiedGraph({
  source,
  copied,
  partIds,
  idMap,
  connectionIdMap,
  allowedExternalConnectionIds = [],
}) {
  const originals = index(source.parts, 'source parts'),
    parts = index(copied.parts, 'copied parts');
  const edgesBefore = index(source.connections, 'source connections'),
    edgesAfter = index(copied.connections, 'copied connections');
  const selected = new Set(partIds),
    newIds = new Set(Object.values(idMap));
  assert.equal(selected.size, partIds.length, 'selection has duplicate IDs');
  assert.deepEqual(
    sorted(Object.keys(idMap)),
    sorted(selected),
    'part map covers selection exactly',
  );
  assert.equal(newIds.size, selected.size, 'part map must be injective');
  const oldReferences = references(source),
    allocatedReferences = new Set();
  for (const part of copied.parts.filter((part) => originals.has(part.id)))
    references(part, oldReferences);
  for (const edge of copied.connections.filter((edge) => edgesBefore.has(edge.id)))
    references(edge, oldReferences);
  for (const id of selected) {
    assert.ok(originals.has(id), `unknown selected part ${id}`);
    const newId = idMap[id];
    assert.equal(typeof newId, 'string', 'copied part ID must be a string');
    assert.ok(!originals.has(newId), 'copied part IDs must be disjoint from input');
    assert.ok(parts.has(newId), `mapped copied part missing: ${newId}`);
    const part = parts.get(newId);
    assert.deepEqual(
      authored(part),
      authored(originals.get(id)),
      'all authored fields except identity/name/pose are preserved',
    );
    for (const ref of references(part)) {
      assert.ok(!oldReferences.has(ref), 'copy aliases an input object');
      assert.ok(!allocatedReferences.has(ref), 'copied parts alias each other');
      allocatedReferences.add(ref);
    }
  }
  assert.deepEqual(
    sorted(parts.keys()),
    sorted([...originals.keys(), ...newIds]),
    'part inventory is exactly originals plus copies',
  );
  for (const [id, part] of originals)
    assert.deepEqual(parts.get(id), part, 'existing parts remain unchanged');
  for (const [id, edge] of edgesBefore)
    assert.deepEqual(edgesAfter.get(id), edge, 'existing connections remain unchanged');

  const internal = source.connections.filter(
    (edge) => selected.has(edge.a.part) && selected.has(edge.b.part),
  );
  const allowed = new Set(allowedExternalConnectionIds),
    mappedIds = Object.values(connectionIdMap);
  assert.equal(
    allowed.size,
    allowedExternalConnectionIds.length,
    'external allowance IDs are unique',
  );
  assert.equal(new Set(mappedIds).size, mappedIds.length, 'connection map must be injective');
  const remap = (endpoint) => ({ ...endpoint, part: idMap[endpoint.part] });
  for (const edge of internal) {
    assert.ok(
      Object.hasOwn(connectionIdMap, edge.id),
      'internal connection omitted from explicit map',
    );
    assert.deepEqual(
      edgesAfter.get(connectionIdMap[edge.id]),
      {
        ...edge,
        id: connectionIdMap[edge.id],
        a: remap(edge.a),
        b: remap(edge.b),
      },
      'internal connection record and endpoints must match explicit map exactly',
    );
  }
  for (const [oldId, newId] of Object.entries(connectionIdMap)) {
    assert.equal(typeof newId, 'string', 'copied connection ID must be a string');
    assert.ok(!edgesBefore.has(newId), 'copied connection IDs must be disjoint from input');
    const old = edgesBefore.get(oldId),
      edge = edgesAfter.get(newId);
    assert.ok(old && edge, 'connection map must bind existing input and output edges');
    const sourceCount = Number(selected.has(old.a.part)) + Number(selected.has(old.b.part));
    const copyCount = Number(newIds.has(edge.a.part)) + Number(newIds.has(edge.b.part));
    if (sourceCount !== 2) {
      assert.equal(
        sourceCount,
        1,
        'only selected internal or explicitly allowed crossing edges can copy',
      );
      assert.ok(allowed.has(newId), 'external edge requires explicit caller policy');
      assert.equal(copyCount, 1, 'allowed external connection must cross the copied boundary');
    } else
      assert.ok(
        !allowed.has(newId),
        'internal edges cannot escape exact checks through external policy',
      );
    for (const ref of references(edge)) {
      assert.ok(!oldReferences.has(ref), 'copied connection aliases an input object');
      assert.ok(!allocatedReferences.has(ref), 'copied connection aliases another copied record');
      allocatedReferences.add(ref);
    }
  }
  assert.deepEqual(
    sorted(allowed),
    sorted(
      mappedIds.filter((id) => {
        const edge = edgesAfter.get(id);
        return Number(newIds.has(edge.a.part)) + Number(newIds.has(edge.b.part)) === 1;
      }),
    ),
    'external policy accounts for exactly the copied crossing edges',
  );
  assert.deepEqual(
    sorted(edgesAfter.keys()),
    sorted([...edgesBefore.keys(), ...mappedIds]),
    'connection inventory has no accidental external or extra edges',
  );
}
