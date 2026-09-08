// Provisioned separately; ordinary workshop releases never reset this owner record.
import { readBounded, json, digest, safeId, fail } from './protocol.mjs';
export class ReleaseCoordinator {
  constructor(state) {
    this.state = state;
    this.sql = state.storage.sql;
    this.sql
      .exec('CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT)')
      .toArray();
  }
  async fetch(request) {
    try {
      this.sql
        .exec(
          'CREATE TABLE IF NOT EXISTS deployed (id INTEGER PRIMARY KEY CHECK(id=1), version TEXT)',
        )
        .toArray();
      this.sql
        .exec('CREATE TABLE IF NOT EXISTS experiment_failures (id TEXT PRIMARY KEY, data TEXT)')
        .toArray();
      if (new URL(request.url).pathname === '/experiment-failures')
        return Response.json({
          failures: this.sql
            .exec('SELECT data FROM experiment_failures ORDER BY id')
            .toArray()
            .map((row) => JSON.parse(row.data)),
        });
      if (new URL(request.url).pathname === '/current')
        return Response.json({
          version:
            this.sql.exec('SELECT version FROM deployed WHERE id=1').toArray()[0]?.version || null,
        });
      const input = json(await readBounded(request.body, 8192));
      if (
        !safeId.test(input.attempt || '') ||
        typeof input.token !== 'string' ||
        input.token.length < 32
      )
        throw fail(403, 'Owner required');
      const hash = await digest(new TextEncoder().encode(input.token));
      const path = new URL(request.url).pathname;
      return this.state.storage.transactionSync(() => {
        const row = this.sql.exec('SELECT data FROM owner WHERE id=1').toArray()[0],
          owner = row && JSON.parse(row.data);
        const same = owner?.attempt === input.attempt && owner?.verifier === hash;
        if (path === '/acquire') {
          const deployed = this.sql
            .exec('SELECT version FROM deployed WHERE id=1')
            .toArray()[0]?.version;
          if (!owner && deployed && deployed !== input.predecessor)
            throw fail(409, 'Stale predecessor');
          if (owner && !same) throw fail(409, 'Publisher busy');
          if (
            owner &&
            (owner.artifact !== input.artifact || owner.predecessor !== input.predecessor)
          )
            throw fail(409, 'Attempt changed');
          if (
            !/^[a-f0-9]{64}$/.test(input.artifact || '') ||
            typeof input.predecessor !== 'string' ||
            input.predecessor.length > 200
          )
            throw fail(400, 'Release identity required');
          if (!owner)
            this.sql
              .exec(
                'INSERT INTO owner VALUES (1,?)',
                JSON.stringify({
                  attempt: input.attempt,
                  verifier: hash,
                  artifact: input.artifact,
                  predecessor: input.predecessor,
                  phase: 'acquired',
                  at: Date.now(),
                }),
              )
              .toArray();
          return Response.json({ owned: true }, { status: owner ? 200 : 201 });
        }
        if (!same) throw fail(403, 'Not publisher owner');
        if (path === '/experiment-failed') {
          const f = input.failure;
          if (
            !f ||
            Object.keys(f).sort().join(',') !==
              'artifact,family,id,identity,measuredAt,reason,status' ||
            typeof f.id !== 'string' ||
            !safeId.test(f.id) ||
            !['endurance', 'capacity'].includes(f.family) ||
            f.status !== 'FAIL' ||
            !/^[a-f0-9]{64}$/.test(f.identity || '') ||
            f.artifact !== owner.artifact ||
            !Number.isFinite(f.measuredAt) ||
            f.measuredAt < 0 ||
            f.measuredAt > Date.now() ||
            typeof f.reason !== 'string' ||
            !f.reason.trim() ||
            f.reason.length > 1000
          )
            throw fail(400, 'Invalid experiment failure');
          const data = JSON.stringify({
            id: f.id,
            family: f.family,
            status: f.status,
            identity: f.identity,
            artifact: f.artifact,
            measuredAt: f.measuredAt,
            reason: f.reason,
          });
          const previous = this.sql
            .exec('SELECT data FROM experiment_failures WHERE id=?', f.id)
            .toArray()[0];
          if (previous) {
            if (previous.data !== data) throw fail(409, 'Experiment failure ID already used');
            return Response.json({ recorded: true }, { status: 200 });
          }
          if (this.sql.exec('SELECT COUNT(*) AS n FROM experiment_failures').toArray()[0].n >= 64)
            throw fail(409, 'Experiment failure history full; resolve failures before publishing');
          this.sql.exec('INSERT INTO experiment_failures VALUES (?,?)', f.id, data).toArray();
          return Response.json({ recorded: true }, { status: 201 });
        }
        // Only the trusted publisher calls this after a fresh actual PASS. A reused
        // receipt must never resolve a known failure. IDs explicitly cover fixed sources.
        if (path === '/experiment-passed') {
          if (
            !['endurance', 'capacity'].includes(input.family) ||
            !/^[a-f0-9]{64}$/.test(input.receiptId || '') ||
            !/^[a-f0-9]{64}$/.test(input.identity || '') ||
            !Number.isFinite(input.measuredAt) ||
            input.measuredAt < 0 ||
            input.measuredAt > Date.now() ||
            !Array.isArray(input.failureIds) ||
            input.failureIds.length > 64 ||
            new Set(input.failureIds).size !== input.failureIds.length ||
            input.failureIds.some((id) => typeof id !== 'string' || !safeId.test(id))
          )
            throw fail(400, 'Invalid experiment pass');
          if (input.artifact !== owner.artifact)
            throw fail(409, 'Experiment artifact differs from publisher');
          const resolved = [];
          for (const id of input.failureIds) {
            const row = this.sql
              .exec('SELECT data FROM experiment_failures WHERE id=?', id)
              .toArray()[0];
            if (!row) continue; // Repeat acknowledgments are idempotent.
            const failure = JSON.parse(row.data);
            if (failure.family !== input.family || input.measuredAt <= failure.measuredAt)
              throw fail(409, 'Experiment failure resolution mismatch');
            resolved.push(id);
          }
          for (const id of resolved)
            this.sql.exec('DELETE FROM experiment_failures WHERE id=?', id).toArray();
          return Response.json({ resolved, receiptId: input.receiptId, artifact: owner.artifact });
        }
        if (path === '/recover') {
          if (
            !/^[a-f0-9]{64}$/.test(input.artifact || '') ||
            typeof input.predecessor !== 'string' ||
            !input.predecessor ||
            input.predecessor.length > 200
          )
            throw fail(400, 'Recovery identity required');
          const recovered = {
            ...owner,
            artifact: input.artifact,
            predecessor: input.predecessor,
            phase: 'recovery',
            at: Date.now(),
            previous: {
              artifact: owner.artifact,
              predecessor: owner.predecessor,
              phase: owner.phase,
            },
          };
          this.sql.exec('UPDATE owner SET data=? WHERE id=1', JSON.stringify(recovered)).toArray();
          return Response.json({ ...recovered, verifier: undefined, owned: true });
        }
        if (path === '/release') this.sql.exec('DELETE FROM owner WHERE id=1').toArray();
        else if (path === '/phase') {
          if (
            ![
              'acquired',
              'paused',
              'deploying',
              'verifying',
              'rollback',
              'cleanup',
              'complete',
              'recovery',
            ].includes(input.phase)
          )
            throw fail(400, 'Invalid phase');
          if (input.phase === 'complete') {
            if (typeof input.version !== 'string' || input.version.length > 100)
              throw fail(400, 'Deployed version required');
            this.sql.exec('INSERT OR REPLACE INTO deployed VALUES (1,?)', input.version).toArray();
          }
          this.sql
            .exec(
              'UPDATE owner SET data=? WHERE id=1',
              JSON.stringify({ ...owner, phase: input.phase, at: Date.now() }),
            )
            .toArray();
        } else if (path !== '/check') throw fail(404, 'Not found');
        return Response.json({
          owned: path !== '/release',
          attempt: owner.attempt,
          artifact: owner.artifact,
          predecessor: owner.predecessor,
          phase: owner.phase,
        });
      });
    } catch (error) {
      return Response.json(
        { error: error.status ? error.message : 'Coordinator failed' },
        { status: error.status || 500 },
      );
    }
  }
}
export default {
  async fetch(request, env) {
    if (
      !env.CONTROL_TOKEN ||
      request.headers.get('authorization') !== `Bearer ${env.CONTROL_TOKEN}`
    )
      return new Response(null, { status: 403 });
    return env.PUBLISHER.get(env.PUBLISHER.idFromName('publisher-v1')).fetch(request);
  },
};
