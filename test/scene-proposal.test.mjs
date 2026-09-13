import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentProposal } from '../src/presentation/document-proposal.mjs';

test('scene proposal rejects stale approval, blocks repeated submission and reconciles only exact source results', async () => {
  let frame = {
    metadata: { blueprint: { id: 'source', parts: [] }, mode: 'build' },
    cursor: { session: 'a', epoch: 0, revision: 0, tick: 0 },
  };
  let complete;
  let calls = 0;
  const proposal = createDocumentProposal({
    getFrame: () => frame,
    evaluate: (value, blueprint) => ({ ...blueprint, environment: value }),
    send: () => {
      calls++;
      return new Promise((resolve) => (complete = resolve));
    },
  });
  proposal.start({ objects: [] });
  frame.cursor.revision++;
  proposal.refresh();
  assert.equal(proposal.read().stale, true);
  assert.equal(await proposal.commit(), null);
  proposal.revalidate();
  const pending = proposal.commit();
  assert.equal(proposal.cancel(), false);
  assert.equal(await proposal.commit(), null);
  assert.equal(calls, 1);
  complete(undefined);
  await pending;
  assert.equal(proposal.read().phase, 'committing');
  frame.metadata.blueprint = { id: 'different', parts: [], environment: { objects: [] } };
  proposal.refresh();
  assert.equal(proposal.read().phase, 'committing');
  frame.metadata.blueprint = { id: 'source', parts: [], environment: { objects: [] } };
  frame.cursor.session = 'another';
  proposal.refresh();
  assert.equal(proposal.read().phase, 'committing');
  frame.cursor.session = 'a';
  proposal.refresh();
  assert.equal(proposal.read().phase, 'accepted');
});
test('scene preview preserves draft on rejection and disallows editing after leaving Build', async () => {
  let frame = {
    metadata: { blueprint: { id: 'source', parts: [] }, mode: 'build' },
    cursor: { session: 'a', revision: 0 },
  };
  const proposal = createDocumentProposal({
    getFrame: () => frame,
    evaluate: (value, bp) => ({ ...bp, environment: value }),
    send: async () => ({ ok: false, reasonCode: 'SURFACE_OVERLAP' }),
  });
  proposal.start({ objects: [] });
  await proposal.commit();
  assert.equal(proposal.read().phase, 'preview');
  assert.deepEqual(proposal.read().value, { objects: [] });
  frame.metadata.mode = 'run';
  proposal.revalidate();
  assert.equal(await proposal.commit(), null);
});
