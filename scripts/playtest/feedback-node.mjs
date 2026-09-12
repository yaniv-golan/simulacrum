// M3b: private atomic directory publication; tombstones prevent deleted IDs resurrecting.
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { open, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFeedbackEnvelope } from '../../src/application/feedback-protocol.mjs';
import { fail } from './protocol.mjs';
import {
  feedbackBudget,
  feedbackId,
  feedbackReferences,
  feedbackReceipt,
} from './feedback-common.mjs';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function sync(path) {
  const h = await open(path, 'r');
  try {
    await h.sync();
  } finally {
    await h.close();
  }
}
export class NodeFeedbackStore {
  constructor(root, { budget, generation, reference }) {
    this.parent = root;
    this.root = join(root, 'feedback');
    this.budget = feedbackBudget(budget);
    this.generation = generation;
    this.reference = reference;
    this.rows = new Map();
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(this.root)) {
      if (/^\.[0-9a-f-]+\.pending$/.test(name)) {
        rmSync(join(this.root, name), { recursive: true, force: true });
        continue;
      }
      if (!feedbackId.test(name)) continue;
      const row = JSON.parse(readFileSync(join(this.root, name, 'receipt.json'), 'utf8'));
      if (!row.deleted) {
        const bytes = readFileSync(join(this.root, name, 'envelope.json'));
        const envelope = parseFeedbackEnvelope(bytes);
        if (envelope.id !== name || digest(bytes) !== row.receipt.uploadHash)
          throw Error('Corrupt feedback publication');
      }
      this.rows.set(name, row);
    }
  }
  async submit(bytes) {
    const envelope = parseFeedbackEnvelope(bytes),
      id = envelope.id,
      hash = digest(bytes);
    const prior = this.rows.get(id);
    if (prior) {
      if (prior.deleted || prior.expires <= Date.now())
        throw fail(410, 'Feedback deleted or expired');
      if (prior.generation !== this.generation) throw fail(403, 'Invitation generation changed');
      if (prior.receipt.uploadHash !== hash) throw fail(409, 'Submission identity conflict');
      await sync(join(this.root, id));
      await sync(this.root);
      await sync(this.parent);
      return { receipt: prior.receipt, status: 200 };
    }
    for (const ref of feedbackReferences(envelope)) this.reference(ref);
    const charge = bytes.length + 4096;
    if (
      this.rows.size >= 100000 ||
      [...this.rows.values()].reduce((n, r) => n + (r.deleted ? 4096 : r.charge), 0) + charge >
        this.budget
    )
      throw fail(413, 'Feedback storage capacity');
    const row = {
      receipt: feedbackReceipt(id, hash),
      generation: this.generation,
      charge,
      references: feedbackReferences(envelope),
      expires: Date.now() + 30 * 86400000,
    };
    const pending = join(this.root, `.${id}.pending`),
      dir = join(this.root, id);
    mkdirSync(pending, { mode: 0o700 });
    try {
      await writeFile(join(pending, 'envelope.json'), bytes, {
        flag: 'wx',
        mode: 0o600,
        flush: true,
      });
      await writeFile(join(pending, 'receipt.json'), JSON.stringify(row), {
        flag: 'wx',
        mode: 0o600,
        flush: true,
      });
      await sync(pending);
      await rename(pending, dir);
    } catch (error) {
      await rm(pending, { recursive: true, force: true });
      throw error;
    }
    this.rows.set(id, row);
    await sync(this.root);
    await sync(this.parent);
    return { receipt: row.receipt, status: 201 };
  }
  list({ sessionId, after, limit }) {
    return [...this.rows.entries()]
      .filter(
        ([id, r]) =>
          id > after &&
          !r.deleted &&
          r.expires > Date.now() &&
          (!sessionId || r.references.some((x) => x.sessionId === sessionId)),
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, limit)
      .map(([submissionId, r]) => ({
        submissionId,
        receivedAt: r.receipt.receivedAt,
        bytes: r.charge - 4096,
        status: 'received',
        references: r.references,
      }));
  }
  async export(id) {
    const row = this.rows.get(id);
    if (!row) throw fail(404, 'Unknown feedback');
    if (row.deleted || row.expires <= Date.now()) throw fail(410, 'Feedback deleted or expired');
    const bodyText = readFileSync(join(this.root, id, 'envelope.json'), 'utf8');
    if (digest(bodyText) !== row.receipt.uploadHash) throw fail(409, 'Feedback checksum mismatch');
    return {
      protocolVersion: 1,
      envelope: parseFeedbackEnvelope(bodyText),
      bodyText,
      receipt: row.receipt,
    };
  }
  async delete(id) {
    const row = this.rows.get(id);
    if (!row) throw fail(404, 'Unknown feedback');
    const dir = join(this.root, id);
    if (row.deleted) {
      await rm(join(dir, 'envelope.json'), { force: true });
      await sync(dir);
      row.cleaned = true;
      return;
    }
    const tombstone = { deleted: true };
    await writeFile(join(dir, 'delete.pending'), JSON.stringify(tombstone), {
      mode: 0o600,
      flush: true,
    });
    await rename(join(dir, 'delete.pending'), join(dir, 'receipt.json'));
    this.rows.set(id, tombstone);
    await sync(dir);
    await rm(join(dir, 'envelope.json'), { force: true });
    await sync(dir);
    tombstone.cleaned = true;
  }
  async cleanup() {
    for (const [id, row] of this.rows)
      if ((row.deleted && !row.cleaned) || row.expires <= Date.now()) await this.delete(id);
  }
}
