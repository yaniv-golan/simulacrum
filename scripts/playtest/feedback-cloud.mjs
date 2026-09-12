// M3b: recoverable private object publication with durable SQL identity and deletion fences.
import { parseFeedbackEnvelope } from '../../src/application/feedback-protocol.mjs';
import { digest, fail } from './protocol.mjs';
import {
  feedbackBudget,
  feedbackReferences,
  feedbackReceipt,
  feedbackId,
  feedbackPage,
} from './feedback-common.mjs';
const reply = (value, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
export class CloudFeedbackStore {
  constructor(owner) {
    this.owner = owner;
    this.budget = feedbackBudget(owner.env.FEEDBACK_STORAGE_BYTES);
    owner.run(
      `CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, hash TEXT, objectKey TEXT, state TEXT, receipt TEXT, refs TEXT, generation TEXT, synthetic TEXT, bytes INTEGER, created INTEGER, expires INTEGER, failures INTEGER DEFAULT 0, nextAttempt INTEGER DEFAULT 0)`,
    );
  }
  row(id, generation, synthetic) {
    const r = this.owner.one('SELECT * FROM feedback WHERE id=?', id);
    if (!r) throw fail(404, 'Unknown feedback');
    if (!['pending', 'committed'].includes(r.state) || r.expires <= Date.now())
      throw fail(410, 'Feedback expired or deleted');
    if (
      generation !== undefined &&
      (r.generation !== generation || r.synthetic !== (synthetic || null))
    )
      throw fail(403, 'Feedback authorization changed');
    for (const ref of JSON.parse(r.refs || '[]')) this.owner.live(ref.sessionId);
    return r;
  }
  usage() {
    return this.owner.one(
      "SELECT COUNT(*) AS submissions, COALESCE(SUM(bytes),0) AS bytes FROM feedback WHERE state!='deleted'",
    );
  }
  cleanupStatus(synthetic) {
    return this.owner.one(
      "SELECT COUNT(*) AS pending, COALESCE(SUM(bytes),0) AS chargedBytes FROM feedback WHERE synthetic=? AND state!='deleted'",
      synthetic,
    );
  }
  async submit(bytes, generation, synthetic, deadline, hold) {
    const owner = this.owner,
      envelope = parseFeedbackEnvelope(bytes),
      id = envelope.id,
      hash = await digest(bytes),
      key = `feedback:${id}`;
    if (owner.pending.has(key)) throw fail(503, 'Submission already active');
    owner.pending.add(key);
    try {
      let row = owner.transaction(() => {
        if (owner.one('SELECT id FROM feedback WHERE id=?', id)) {
          const prior = this.row(id, generation, synthetic);
          if (prior.hash !== hash) throw fail(409, 'Submission identity conflict');
          return prior;
        }
        for (const ref of feedbackReferences(envelope)) {
          const session = owner.live(ref.sessionId, generation);
          if (session.synthetic !== (synthetic || null))
            throw fail(403, 'Reference not authorized for invitation scope');
        }
        const charge = bytes.length + 4096,
          usage = this.usage();
        if (usage.bytes + charge > this.budget) throw fail(413, 'Feedback storage capacity');
        let expires = Date.now() + 30 * 86400000;
        if (synthetic) {
          const run = owner.one('SELECT * FROM synthetic WHERE id=?', synthetic);
          if (!run || run.expires <= Date.now() || run.bytes < charge)
            throw fail(413, 'Synthetic reservation unavailable');
          owner.run('UPDATE synthetic SET bytes=bytes-? WHERE id=?', charge, synthetic);
          expires = run.expires;
        }
        owner.reserveLifetime(4096, synthetic);
        const objectKey = crypto.randomUUID().replaceAll('-', '');
        owner.run(
          "INSERT INTO feedback (id,hash,objectKey,state,refs,generation,synthetic,bytes,created,expires) VALUES (?,?,?,'pending',?,?,?,?,?,?)",
          id,
          hash,
          objectKey,
          JSON.stringify(feedbackReferences(envelope)),
          generation,
          synthetic || null,
          charge,
          Date.now(),
          expires,
        );
        return { ...this.row(id, generation, synthetic), fresh: true };
      });
      if (row.state === 'committed') return reply(JSON.parse(row.receipt));
      // Persist an alarm before R2 awaits, so deletion/retention survives restarts.
      await owner.reconcile();
      let object = row.fresh
        ? null
        : await owner.io(() => owner.env.RECORDINGS.get(row.objectKey), deadline, hold);
      this.row(id, generation, synthetic);
      if (!object) {
        object = await owner.io(
          () =>
            owner.env.RECORDINGS.put(row.objectKey, bytes, {
              onlyIf: { etagDoesNotMatch: '*' },
              sha256: hash,
              customMetadata: { sha256: hash },
            }),
          deadline,
          hold,
        );
        if (!object)
          object = await owner.io(() => owner.env.RECORDINGS.get(row.objectKey), deadline, hold);
      }
      this.row(id, generation, synthetic);
      if (object?.customMetadata?.deleted === '1') throw fail(410, 'Feedback deleted');
      if (!object || object.size !== bytes.length || object.customMetadata?.sha256 !== hash)
        throw fail(409, 'Feedback object conflict');
      if (
        object.arrayBuffer &&
        (await digest(
          new Uint8Array(await owner.io(() => object.arrayBuffer(), deadline, hold)),
        )) !== hash
      )
        throw fail(409, 'Feedback checksum conflict');
      if (Date.now() >= deadline) throw fail(503, 'Operation deadline');
      const receipt = owner.transaction(() => {
        row = this.row(id, generation, synthetic);
        if (row.state === 'committed') return JSON.parse(row.receipt);
        const received = feedbackReceipt(id, hash);
        owner.run(
          "UPDATE feedback SET receipt=?,state='committed' WHERE id=?",
          JSON.stringify(received),
          id,
        );
        return received;
      });
      return reply(receipt, 201);
    } finally {
      owner.pending.delete(key);
    }
  }
  async admin(request, url) {
    const owner = this.owner,
      path = url.pathname;
    if (path === '/admin/playtest/feedback' && request.method === 'GET') {
      const { sessionId, after, limit } = feedbackPage(url);
      const rows = owner.run(
        "SELECT * FROM feedback WHERE state='committed' AND expires>? AND id>? AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(feedback.refs) WHERE json_extract(value,'$.sessionId')=?)) ORDER BY id LIMIT ?",
        Date.now(),
        after,
        sessionId,
        sessionId,
        limit,
      );
      return reply(
        rows.map((r) => ({
          submissionId: r.id,
          receivedAt: JSON.parse(r.receipt).receivedAt,
          bytes: r.bytes - 4096,
          status: 'received',
          references: JSON.parse(r.refs),
        })),
      );
    }
    const match = /^\/admin\/playtest\/feedback\/([^/]+)\/(export|delete)$/.exec(path);
    if (!match || !feedbackId.test(match[1])) throw fail(404, 'Not found');
    if (match[2] === 'delete' && request.method === 'POST') {
      if (!owner.one('SELECT id FROM feedback WHERE id=?', match[1]))
        throw fail(404, 'Unknown feedback');
      owner.run(
        "UPDATE feedback SET state='deleting',nextAttempt=0 WHERE id=? AND state!='deleted'",
        match[1],
      );
      await owner.reconcile();
      return reply({ pending: true }, 202);
    }
    if (match[2] !== 'export' || request.method !== 'GET') throw fail(404, 'Not found');
    const row = this.row(match[1]);
    if (row.state !== 'committed') throw fail(409, 'Feedback not received');
    const object = await owner.io(() => owner.env.RECORDINGS.get(row.objectKey));
    this.row(row.id);
    if (!object || object.customMetadata?.deleted === '1') throw fail(410, 'Feedback unavailable');
    const bytes = new Uint8Array(await owner.io(() => object.arrayBuffer()));
    this.row(row.id);
    if ((await digest(bytes)) !== row.hash) throw fail(409, 'Feedback checksum mismatch');
    const bodyText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return reply({
      protocolVersion: 1,
      envelope: parseFeedbackEnvelope(bodyText),
      bodyText,
      receipt: JSON.parse(row.receipt),
    });
  }
  async cleanup() {
    const o = this.owner;
    o.run(
      "UPDATE feedback SET state='deleting',nextAttempt=0 WHERE state IN ('pending','committed') AND EXISTS (SELECT 1 FROM json_each(feedback.refs) ref JOIN sessions s ON s.id=json_extract(ref.value,'$.sessionId') WHERE s.state!='open' OR s.expires<=?)",
      Date.now(),
    );
    o.run(
      "UPDATE feedback SET state='deleting' WHERE state IN ('pending','committed') AND expires<=?",
      Date.now(),
    );
    await Promise.all(
      o
        .run("SELECT * FROM feedback WHERE state='deleting' AND nextAttempt<=? LIMIT 8", Date.now())
        .map(async (row) => {
          try {
            await o.fence(row.objectKey);
            o.transaction(() => {
              if (row.synthetic)
                o.run('UPDATE synthetic SET bytes=bytes+? WHERE id=?', row.bytes, row.synthetic);
              o.run(
                "UPDATE feedback SET state='deleted',hash=NULL,receipt=NULL,refs=NULL,generation=NULL,synthetic=NULL,bytes=0 WHERE id=?",
                row.id,
              );
            });
          } catch {
            o.run(
              'UPDATE feedback SET failures=failures+1,nextAttempt=? WHERE id=?',
              Date.now() + Math.min(900000, 30000 * 2 ** Math.min(row.failures, 5)),
              row.id,
            );
          }
        }),
    );
  }
  deleteScope(column, value) {
    if (!['synthetic', 'id'].includes(column)) throw Error('Invalid feedback scope');
    this.owner.run(
      `UPDATE feedback SET state='deleting',nextAttempt=0 WHERE ${column}=? AND state!='deleted'`,
      value,
    );
  }
}
