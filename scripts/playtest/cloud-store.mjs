// M3b: one stable store owns all capacity and receipt decisions. R2 is not transactional with SQL.
import {
  LIMITS,
  admission,
  readBounded,
  json,
  digest,
  uploadHash,
  mediaIdentity,
  safeId,
  fail,
} from './protocol.mjs';
const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
const reply = (value, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
export class CaptureStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.readers = admission();
    this.pending = new Set();
    this.inflight = 0;
    this.circuit = false;
    this.cleaning = false;
    this.sql = state.storage.sql;
    this.run(
      'CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER, lifetime INTEGER)',
    );
    this.run('INSERT OR IGNORE INTO ledger VALUES (1,2,0)');
    if (this.one('SELECT version FROM ledger').version !== 2)
      throw Error('Unsupported capture schema');
    this.run(
      `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, requestId TEXT UNIQUE, requestHash TEXT, metadata TEXT, created INTEGER, expires INTEGER, generation TEXT, state TEXT, bytes INTEGER, records INTEGER, sequence INTEGER, synthetic TEXT, nextAttempt INTEGER DEFAULT 0, failures INTEGER DEFAULT 0, lastError TEXT, lastCleanup INTEGER)`,
    );
    this.run(
      `CREATE TABLE IF NOT EXISTS uploads (session TEXT, logicalKey TEXT, objectKey TEXT UNIQUE, data TEXT, state TEXT, sequence INTEGER, PRIMARY KEY(session,logicalKey))`,
    );
    this.run('CREATE INDEX IF NOT EXISTS upload_session_sequence ON uploads(session,sequence)');
    this.run(
      'CREATE TABLE IF NOT EXISTS synthetic (id TEXT PRIMARY KEY, slots INTEGER, bytes INTEGER, expires INTEGER, metadata INTEGER NOT NULL DEFAULT 0)',
    );
    if (!this.run('PRAGMA table_info(synthetic)').some((column) => column.name === 'metadata'))
      this.run('ALTER TABLE synthetic ADD COLUMN metadata INTEGER NOT NULL DEFAULT 0');
  }
  run(query, ...args) {
    return this.sql.exec(query, ...args).toArray();
  }
  one(query, ...args) {
    return this.run(query, ...args)[0];
  }
  transaction(fn) {
    return this.state.storage.transactionSync(fn);
  }
  usage() {
    return this.one(
      "SELECT COUNT(*) AS sessions, COALESCE(SUM(bytes),0) AS bytes FROM sessions WHERE state!='deleted'",
    );
  }
  live(id, generation) {
    const s = this.one('SELECT * FROM sessions WHERE id=?', id);
    if (!s) throw fail(404, 'Unknown session');
    if (s.state !== 'open' || s.expires <= Date.now())
      throw fail(410, 'Session expired or deleted');
    if (generation !== undefined && s.generation !== generation)
      throw fail(403, 'Invitation generation changed');
    return s;
  }
  reserveLifetime(bytes, synthetic) {
    if (synthetic) {
      const held = this.one('SELECT metadata FROM synthetic WHERE id=?', synthetic);
      if (!held || held.metadata < bytes) throw fail(413, 'metadata-capacity');
      this.run('UPDATE synthetic SET metadata=metadata-? WHERE id=?', bytes, synthetic);
    }
    const n = this.one('SELECT lifetime FROM ledger').lifetime;
    if (
      n + bytes + this.one('SELECT COALESCE(SUM(metadata),0) AS n FROM synthetic').n >
      LIMITS.metadataBytes
    )
      throw fail(413, 'metadata-capacity');
    this.run('UPDATE ledger SET lifetime=lifetime+? WHERE id=1', bytes);
  }
  async io(fn, deadline = Date.now() + 10000) {
    if (this.inflight >= 2) throw fail(503, 'Storage operations saturated');
    this.inflight++;
    let timer;
    const operation = Promise.resolve().then(fn);
    operation.then(
      () => {
        if (--this.inflight === 0) this.circuit = false;
      },
      () => {
        if (--this.inflight === 0) this.circuit = false;
      },
    );
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => {
              this.circuit = true;
              reject(fail(503, 'Storage response deadline'));
            },
            Math.max(1, Math.min(10000, deadline - Date.now())),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async fetch(request) {
    let release;
    try {
      const url = new URL(request.url),
        path = url.pathname;
      if (path.startsWith('/admin/playtest/')) return await this.admin(request, url);
      if (request.method !== 'POST') throw fail(404, 'Not found');
      const start = path === '/api/playtest/v2/session';
      const match = /^\/api\/playtest\/v2\/([a-f0-9]{32})\/(event|media)$/.exec(path);
      if (!start && !match) throw fail(404, 'Not found');
      if (this.circuit) throw fail(503, 'Storage unavailable');
      const generation = request.headers.get('x-invitation-generation');
      if (generation !== String(this.env.INVITATION_GENERATION))
        throw fail(403, 'Invitation generation changed');
      const existingSession = match ? this.live(match[1], generation) : null;
      const media =
        match?.[2] === 'media' ? mediaIdentity(url, request.headers.get('content-type')) : null;
      if (media?.kind === 'screen' && JSON.parse(existingSession.metadata).recordingMode === 'data')
        throw fail(403, 'Screen media not admitted for data session');
      if (!media && request.headers.get('content-type')?.split(';')[0] !== 'application/json')
        throw fail(415, 'Expected JSON');
      const limit = start ? LIMITS.startBytes : media ? LIMITS.mediaBytes : LIMITS.eventBytes;
      release = this.readers.acquire(limit);
      const deadline = Date.now() + 40000;
      const bytes = await readBounded(request.body, limit);
      if (Date.now() >= deadline) throw fail(408, 'Operation deadline');
      if (start)
        return await this.create(bytes, generation, request.headers.get('x-synthetic-run'));
      const event = media ? null : json(bytes);
      if (event && !safeId.test(event.id || '')) throw fail(400, 'Event id required');
      const logicalKey = media
        ? `media:${media.kind}:${media.clip}:${media.seq}`
        : `event:${event.id}`;
      const hash = await uploadHash(bytes, media?.mime || ''),
        rawHash = await digest(bytes);
      if (Date.now() >= deadline) throw fail(408, 'Operation deadline');
      return await this.upload(
        match[1],
        generation,
        logicalKey,
        bytes,
        hash,
        rawHash,
        media,
        deadline,
      );
    } catch (error) {
      return Response.json(
        { error: error.status ? error.message : 'Capture failed' },
        {
          status: error.status || 500,
          headers: {
            'cache-control': 'no-store',
            ...([429, 503].includes(error.status) ? { 'retry-after': '3' } : {}),
          },
        },
      );
    } finally {
      release?.();
    }
  }
  async create(bytes, generation, synthetic) {
    const input = json(bytes);
    if (
      !safeId.test(input.requestId || '') ||
      !input.metadata ||
      typeof input.metadata !== 'object' ||
      Array.isArray(input.metadata)
    )
      throw fail(400, 'Invalid session creation');
    const recordingMode = input.metadata.recordingMode ?? 'data';
    if (!['data', 'video'].includes(recordingMode) || (input.metadata.captureSchema ?? 1) !== 1)
      throw fail(400, 'Invalid recording mode or capture schema');
    const hash = await digest(bytes),
      metadata = JSON.stringify({
        ...input.metadata,
        recordingMode,
        captureSchema: 1,
        backend: { protocolVersion: 2, deployment: this.env.WORKER_VERSION?.id || 'local' },
      }),
      charge = new TextEncoder().encode(metadata).length + 4096;
    if (charge > LIMITS.startBytes + 4096) throw fail(413, 'Session metadata too large');
    const result = this.transaction(() => {
      const prior = this.one('SELECT * FROM sessions WHERE requestId=?', input.requestId);
      if (prior) {
        this.live(prior.id, generation);
        if (prior.requestHash !== hash) throw fail(409, 'Creation identity conflict');
        return { sessionId: prior.id, retry: true };
      }
      if (recordingMode === 'video' && this.env.CAPTURE_OPTIONAL_VIDEO !== 'true')
        throw fail(403, 'Video capture disabled');
      if (this.env.CAPTURE_NEW_SESSIONS === 'false') throw fail(503, 'New capture disabled');
      const usage = this.usage(),
        reserved = this.one(
          'SELECT COALESCE(SUM(slots),0) AS slots, COALESCE(SUM(bytes),0) AS bytes FROM synthetic',
        );
      let expires = Date.now() + 30 * 86400000;
      if (synthetic) {
        const run = this.one('SELECT * FROM synthetic WHERE id=?', synthetic);
        if (!run || run.expires <= Date.now() || run.slots < 1 || run.bytes < charge)
          throw fail(413, 'Synthetic reservation unavailable');
        expires = run.expires;
        this.run('UPDATE synthetic SET slots=slots-1, bytes=bytes-? WHERE id=?', charge, synthetic);
      } else if (
        usage.sessions + reserved.slots >= LIMITS.sessions ||
        usage.bytes + reserved.bytes + charge > LIMITS.aggregateBytes
      )
        throw fail(413, 'Session capacity');
      this.reserveLifetime(4096, synthetic);
      const id = crypto.randomUUID().replaceAll('-', ''),
        now = Date.now();
      this.run(
        "INSERT INTO sessions (id,requestId,requestHash,metadata,created,expires,generation,state,bytes,records,sequence,synthetic) VALUES (?,?,?,?,?,?,?,'open',?,0,0,?)",
        id,
        input.requestId,
        hash,
        metadata,
        now,
        expires,
        generation,
        charge,
        synthetic || null,
      );
      return { sessionId: id, retry: false };
    });
    await this.reconcile();
    return reply(
      {
        sessionId: result.sessionId,
        protocolVersion: 2,
        requestId: input.requestId,
        requestHash: hash,
      },
      result.retry ? 200 : 201,
    );
  }
  async upload(id, generation, key, bytes, hash, rawHash, media, deadline) {
    const active = `${id}/${key}`;
    if (this.pending.has(active)) throw fail(503, 'Upload already active');
    this.pending.add(active);
    try {
      let record = this.transaction(() => {
        const session = this.live(id, generation),
          prior = this.one('SELECT * FROM uploads WHERE session=? AND logicalKey=?', id, key);
        if (prior) {
          const data = JSON.parse(prior.data);
          if (data.uploadHash !== hash) throw fail(409, 'Identity already has different content');
          return { ...data, state: prior.state };
        }
        const data = {
          sessionId: id,
          logicalKey: key,
          uploadHash: hash,
          sha256: rawHash,
          bytes: bytes.length,
          media,
          objectKey: crypto.randomUUID().replaceAll('-', ''),
          receipt: null,
        };
        if (encode(data).length + 512 > 4096) throw fail(413, 'Pointer metadata too large');
        const charge = bytes.length + 4096,
          usage = this.usage(),
          reserved = this.one('SELECT COALESCE(SUM(bytes),0) AS bytes FROM synthetic');
        if (session.records >= LIMITS.uploads || session.bytes + charge > LIMITS.sessionBytes)
          throw fail(413, 'Session capacity');
        if (session.synthetic) {
          const run = this.one('SELECT * FROM synthetic WHERE id=?', session.synthetic);
          if (!run || run.expires <= Date.now() || run.bytes < charge)
            throw fail(413, 'Synthetic reservation exhausted');
          this.run('UPDATE synthetic SET bytes=bytes-? WHERE id=?', charge, session.synthetic);
        } else if (usage.bytes + reserved.bytes + charge > LIMITS.aggregateBytes)
          throw fail(413, 'Storage capacity');
        this.reserveLifetime(4096, session.synthetic);
        this.run(
          "INSERT INTO uploads VALUES (?,?,?,?,'pending',NULL)",
          id,
          key,
          data.objectKey,
          JSON.stringify(data),
        );
        this.run('UPDATE sessions SET bytes=bytes+?,records=records+1 WHERE id=?', charge, id);
        return { ...data, state: 'pending' };
      });
      if (record.state === 'committed') return reply(record.receipt);
      let object = await this.io(() => this.env.RECORDINGS.get(record.objectKey), deadline);
      this.live(id, generation);
      if (!object) {
        if (Date.now() >= deadline) throw fail(503, 'Operation deadline');
        object = await this.io(
          () =>
            this.env.RECORDINGS.put(record.objectKey, bytes, {
              onlyIf: { etagDoesNotMatch: '*' },
              sha256: rawHash,
              customMetadata: { sha256: rawHash },
            }),
          deadline,
        );
        if (!object)
          object = await this.io(() => this.env.RECORDINGS.get(record.objectKey), deadline);
      }
      this.live(id, generation);
      if (object?.customMetadata?.deleted === '1') throw fail(410, 'Deleted payload');
      if (!object || object.size !== bytes.length || object.customMetadata?.sha256 !== rawHash)
        throw fail(409, 'Stored payload conflict');
      // R2 verifies supplied SHA-256 on create. Existing objects are also read/hash checked.
      if (
        object.arrayBuffer &&
        (await digest(new Uint8Array(await this.io(() => object.arrayBuffer(), deadline)))) !==
          rawHash
      )
        throw fail(409, 'Stored payload checksum');
      if (Date.now() >= deadline) throw fail(503, 'Operation deadline');
      record = this.transaction(() => {
        const session = this.live(id, generation),
          current = this.one('SELECT * FROM uploads WHERE session=? AND logicalKey=?', id, key);
        const data = JSON.parse(current.data);
        if (current.state === 'committed') return data;
        data.receipt = {
          protocolVersion: 2,
          sessionId: id,
          logicalKey: key,
          uploadHash: hash,
          sequence: session.sequence + 1,
          receivedAt: new Date().toISOString(),
        };
        this.run(
          "UPDATE uploads SET data=?,state='committed',sequence=? WHERE session=? AND logicalKey=?",
          JSON.stringify(data),
          data.receipt.sequence,
          id,
          key,
        );
        this.run('UPDATE sessions SET sequence=sequence+1 WHERE id=?', id);
        return data;
      });
      return reply(record.receipt, 201);
    } finally {
      this.pending.delete(active);
    }
  }
  async admin(request, url) {
    const path = url.pathname;
    if (path === '/admin/playtest/reconcile' && request.method === 'POST') {
      await this.reconcile();
      return reply({ scheduled: true });
    }
    if (path === '/admin/playtest/status' && request.method === 'GET')
      return reply({
        ...this.usage(),
        reservedMetadataBytes: this.one('SELECT COALESCE(SUM(metadata),0) AS n FROM synthetic').n,
        lifetimeMetadataBytes: this.one('SELECT lifetime FROM ledger').lifetime,
        metadataWarning:
          this.one('SELECT lifetime FROM ledger').lifetime >= LIMITS.metadataBytes * 0.8,
        readers: this.readers.status(),
        storageUnavailable: this.circuit,
        cleanup: this.run(
          "SELECT id,state,nextAttempt,failures,lastError,lastCleanup FROM sessions WHERE state IN ('expired','deleting')",
        ),
      });
    if (path === '/admin/playtest/sessions' && request.method === 'GET')
      return reply(
        this.run(
          "SELECT id,created,expires,state,bytes,sequence,synthetic FROM sessions WHERE state!='deleted' ORDER BY created",
        ),
      );
    if (path === '/admin/playtest/cleanup-retry' && request.method === 'POST') {
      this.run("UPDATE sessions SET nextAttempt=0 WHERE state IN ('expired','deleting')");
      await this.reconcile();
      return reply({ scheduled: true });
    }
    if (path === '/admin/playtest/synthetic' && request.method === 'POST') {
      const input = json(await readBounded(request.body, 4096));
      const result = this.transaction(() => {
        if (
          !Number.isSafeInteger(input.slots) ||
          input.slots < 1 ||
          input.slots > 20 ||
          !Number.isSafeInteger(input.bytes) ||
          input.bytes < 4096 ||
          input.bytes > LIMITS.aggregateBytes
        )
          throw fail(400, 'Invalid synthetic reservation');
        const usage = this.usage(),
          held = this.one(
            'SELECT COALESCE(SUM(slots),0) AS slots,COALESCE(SUM(bytes),0) AS bytes FROM synthetic',
          );
        if (
          usage.sessions + held.slots + input.slots > 20 ||
          usage.bytes + held.bytes + input.bytes > LIMITS.aggregateBytes
        )
          throw fail(413, 'Synthetic capacity');
        const metadata =
          input.metadataBytes ??
          (input.slots + Math.min(input.slots * LIMITS.uploads, Math.ceil(input.bytes / 4096))) *
            4096;
        if (
          !Number.isSafeInteger(metadata) ||
          metadata < input.slots * 4096 ||
          metadata +
            this.one('SELECT lifetime FROM ledger').lifetime +
            this.one('SELECT COALESCE(SUM(metadata),0) AS n FROM synthetic').n >
            LIMITS.metadataBytes
        )
          throw fail(413, 'metadata-capacity');
        const id = crypto.randomUUID(),
          expires = Date.now() + 2 * 3600000;
        this.run(
          'INSERT INTO synthetic (id,slots,bytes,expires,metadata) VALUES (?,?,?,?,?)',
          id,
          input.slots,
          input.bytes,
          expires,
          metadata,
        );
        return { id, expires };
      });
      await this.reconcile();
      return reply(result, 201);
    }
    const drain = /^\/admin\/playtest\/synthetic\/([a-f0-9-]{36})\/drain$/.exec(path);
    if (drain && request.method === 'POST') {
      this.run(
        "UPDATE sessions SET state='deleting',nextAttempt=0 WHERE synthetic=? AND state!='deleted'",
        drain[1],
      );
      await this.reconcile();
      return reply({ pending: true }, 202);
    }
    const cleanup = /^\/admin\/playtest\/synthetic\/([a-f0-9-]{36})$/.exec(path);
    if (cleanup && request.method === 'DELETE') {
      this.run(
        "UPDATE sessions SET state='deleting' WHERE synthetic=? AND state!='deleted'",
        cleanup[1],
      );
      this.run('DELETE FROM synthetic WHERE id=?', cleanup[1]);
      await this.reconcile();
      return reply({ pending: true }, 202);
    }
    const match = /^\/admin\/playtest\/([a-f0-9]{32})\/(snapshot|object|delete)$/.exec(path);
    if (!match) throw fail(404, 'Not found');
    const id = match[1];
    if (match[2] === 'delete' && request.method === 'POST') {
      if (!this.one('SELECT id FROM sessions WHERE id=?', id)) throw fail(404, 'Unknown session');
      this.run(
        "UPDATE sessions SET state='deleting',nextAttempt=0 WHERE id=? AND state!='deleted'",
        id,
      );
      await this.reconcile();
      return reply({ pending: true }, 202);
    }
    if (request.method !== 'GET') throw fail(404, 'Not found');
    const session = this.live(id);
    if (match[2] === 'snapshot') {
      const after = Number(url.searchParams.get('after') || 0),
        cutoff = Number(url.searchParams.get('cutoff') || session.sequence);
      if (
        !Number.isSafeInteger(after) ||
        after < 0 ||
        !Number.isSafeInteger(cutoff) ||
        cutoff < 0 ||
        cutoff > session.sequence
      )
        throw fail(400, 'Invalid export cursor');
      const rows = this.run(
        "SELECT data FROM uploads WHERE session=? AND state='committed' AND sequence>? AND sequence<=? ORDER BY sequence LIMIT 100",
        id,
        after,
        cutoff,
      ).map((r) => JSON.parse(r.data));
      return reply({
        session: {
          sessionId: id,
          metadata: JSON.parse(session.metadata),
          syntheticRun: session.synthetic || null,
          receivedAt: new Date(session.created).toISOString(),
        },
        cutoff,
        completion: 'not proven',
        uploads: rows,
      });
    }
    const key = url.searchParams.get('key');
    const row = this.one(
      "SELECT data FROM uploads WHERE session=? AND objectKey=? AND state='committed'",
      id,
      key || '',
    );
    if (!row) throw fail(404, 'Unknown object');
    const object = await this.io(() => this.env.RECORDINGS.get(key));
    this.live(id);
    if (!object || object.customMetadata?.deleted === '1') throw fail(410, 'Object unavailable');
    return new Response(object.body || (await object.arrayBuffer()), {
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' },
    });
  }
  async reconcile() {
    const target = Date.now() + 1000,
      current = await this.state.storage.getAlarm();
    if (!current || current > target) await this.state.storage.setAlarm(target);
  }
  async alarm() {
    if (this.cleaning) return;
    this.cleaning = true;
    const start = Date.now();
    let processed = 0;
    try {
      await this.state.storage.setAlarm(Date.now() + 60000);
      this.run("UPDATE sessions SET state='expired' WHERE state='open' AND expires<=?", Date.now());
      this.run('DELETE FROM synthetic WHERE expires<=?', Date.now());
      const sessions = this.run(
        "SELECT * FROM sessions WHERE state IN ('expired','deleting') AND nextAttempt<=?",
        Date.now(),
      );
      for (const session of sessions) {
        try {
          this.run("UPDATE sessions SET state='deleting' WHERE id=?", session.id);
          for (const row of this.run(
            "SELECT objectKey FROM uploads WHERE session=? AND state!='fenced' LIMIT 100",
            session.id,
          )) {
            if (processed >= 100 || Date.now() - start >= 10000) return;
            processed++;
            await this.io(() =>
              this.env.RECORDINGS.put(row.objectKey, new Uint8Array(), {
                customMetadata: { deleted: '1' },
              }),
            );
            this.run("UPDATE uploads SET state='fenced' WHERE objectKey=?", row.objectKey);
          }
          this.transaction(() => {
            if (
              !this.one(
                "SELECT objectKey FROM uploads WHERE session=? AND state!='fenced' LIMIT 1",
                session.id,
              )
            ) {
              if (session.synthetic)
                this.run(
                  'UPDATE synthetic SET slots=slots+1,bytes=bytes+? WHERE id=?',
                  session.bytes,
                  session.synthetic,
                );
              this.run(
                'UPDATE uploads SET data=NULL,logicalKey=objectKey,sequence=NULL WHERE session=?',
                session.id,
              );
              this.run(
                "UPDATE sessions SET state='deleted',metadata=NULL,requestHash=NULL,requestId=NULL,bytes=0,records=0,sequence=0,generation=NULL,synthetic=NULL,lastError=NULL,lastCleanup=? WHERE id=?",
                Date.now(),
                session.id,
              );
            }
          });
        } catch {
          const delay = Math.min(900000, 30000 * 2 ** Math.min(session.failures, 5));
          this.run(
            "UPDATE sessions SET failures=failures+1,lastError='storage',nextAttempt=? WHERE id=?",
            Date.now() + delay + Math.floor(Math.random() * 1000),
            session.id,
          );
        }
      }
    } finally {
      this.cleaning = false;
      const pending = this.one(
        "SELECT id FROM sessions WHERE state IN ('expired','deleting') AND nextAttempt<=? LIMIT 1",
        Date.now(),
      );
      await this.state.storage.setAlarm(Date.now() + (pending ? 1000 : 60000));
    }
  }
}
