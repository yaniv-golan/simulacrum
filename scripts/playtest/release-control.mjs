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
      if (new URL(request.url).pathname === '/current')
        return Response.json({
          version:
            this.sql.exec('SELECT version FROM deployed WHERE id=1').toArray()[0]?.version || null,
        });
      const input = json(await readBounded(request.body, 4096));
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
