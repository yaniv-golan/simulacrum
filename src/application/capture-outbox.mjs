/** M3b: durable v2 request ownership. Legacy databases are never upgraded or mutated. */
export const CAPTURE_DB = 'simulacrum-playtest-outbox-v2';
const encoder = new TextEncoder();
export async function captureDigest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
const metadataSize = (row) => encoder.encode(JSON.stringify({ ...row, body: undefined })).length;
export function validReceipt(row, ack) {
  return (
    ack?.protocolVersion === 2 &&
    ack.sessionId === row.sessionId &&
    ack.logicalKey === row.logicalKey &&
    ack.uploadHash === row.uploadHash &&
    Number.isSafeInteger(ack.sequence) &&
    ack.sequence > 0 &&
    Number.isFinite(Date.parse(ack.receivedAt))
  );
}
export async function openCaptureOutbox() {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open(CAPTURE_DB, 1);
    r.onupgradeneeded = () => {
      for (const name of ['items', 'starts', 'groups'])
        r.result.createObjectStore(name, { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  function read(name) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readonly'),
        r = tx.objectStore(name).getAll();
      tx.oncomplete = () => resolve(r.result);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
  function mutate(fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['items', 'starts', 'groups'], 'readwrite'),
        rows = {},
        stores = {};
      let remaining = 3,
        result,
        error;
      for (const name of ['items', 'starts', 'groups']) {
        const store = (stores[name] = tx.objectStore(name)),
          r = store.getAll();
        r.onsuccess = () => {
          rows[name] = r.result;
          if (--remaining) return;
          try {
            const signature = (row) =>
              JSON.stringify({
                ...row,
                body: row.body ? { size: row.body.size, type: row.body.type } : null,
              });
            const before = Object.fromEntries(
              Object.entries(rows).map(([name, list]) => [
                name,
                new Map(list.map((row) => [row.id, signature(row)])),
              ]),
            );
            result = fn(rows);
            const all = Object.values(rows).flat();
            if (all.reduce((sum, row) => sum + (row.body?.size || 0), 0) > 100 * 1024 ** 2)
              throw Error('Local capture limit reached');
            if (all.reduce((sum, row) => sum + metadataSize(row), 0) > 16 * 1024 ** 2)
              throw Error('Local capture metadata limit reached');
            for (const key of Object.keys(stores)) {
              const ids = new Set(rows[key].map((row) => row.id));
              for (const id of before[key].keys()) if (!ids.has(id)) stores[key].delete(id);
              for (const row of rows[key])
                if (before[key].get(row.id) !== signature(row)) stores[key].put(row);
            }
          } catch (e) {
            error = e;
            tx.abort();
          }
        };
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(error || tx.error);
      tx.onabort = () => reject(error || tx.error || Error('Outbox transaction aborted'));
    });
  }
  return {
    close: () => db.close(),
    items: () => read('items'),
    starts: () => read('starts'),
    groups: () => read('groups'),
    async enqueue(value) {
      const url = new URL(value.url, 'https://capture.invalid');
      const match = /^\/api\/playtest\/v2\/([a-f0-9]{32})\/(event|media)$/.exec(url.pathname);
      if (!match || !value.url.startsWith('/api/playtest/v2/'))
        throw Error('Invalid upload destination');
      const raw = new Uint8Array(await value.body.arrayBuffer());
      const logicalKey =
        match[2] === 'event'
          ? `event:${JSON.parse(new TextDecoder().decode(raw)).id}`
          : `media:${url.searchParams.get('kind')}:${url.searchParams.get('clip')}:${url.searchParams.get('seq')}`;
      const mime = encoder.encode(match[2] === 'media' ? value.type.toLowerCase() : '');
      const joined = new Uint8Array(mime.length + raw.length);
      joined.set(mime);
      joined.set(raw, mime.length);
      const uploadHash = await captureDigest(joined),
        id = `${match[1]}/${logicalKey}`;
      return mutate((rows) => {
        if (rows.starts.some((row) => row.sessionId === match[1] && row.outcome === 'discarded'))
          throw Error('Local session deleted');
        const prior = rows.items.find((r) => r.id === id);
        if (prior) {
          if (prior.uploadHash !== uploadHash) throw Error('Local identity conflict');
          return id;
        }
        rows.items.push({
          ...value,
          id,
          sessionId: match[1],
          logicalKey,
          uploadHash,
          outcome: 'pending',
          enqueueOrder: rows.items.reduce((n, row) => Math.max(n, row.enqueueOrder || 0), 0) + 1,
          attempts: 0,
          nextAttempt: 0,
        });
        return id;
      });
    },
    acknowledge(row, ack) {
      if (!validReceipt(row, ack)) return Promise.reject(Error('Receipt identity mismatch'));
      return mutate((rows) => {
        const current = rows.items.find((r) => r.id === row.id);
        if (!current || current.uploadHash !== row.uploadHash)
          throw Error('Local upload unavailable');
        if (current.outcome === 'received') {
          if (JSON.stringify(current.ack) !== JSON.stringify(ack))
            throw Error('Conflicting receipt');
          return;
        }
        if (current.outcome === 'discarded') throw Error('Local upload discarded');
        Object.assign(current, { outcome: 'received', ack, body: null, error: null });
      });
    },
    async next(now = Date.now()) {
      const rows = await read('items');
      const blocked = new Set(rows.filter((r) => r.outcome === 'blocked').map((r) => r.sessionId));
      // Legacy rows precede new work; insertion order is durable across remounts.
      rows.sort((a, b) => (a.enqueueOrder || 0) - (b.enqueueOrder || 0));
      return rows.find(
        (r) => r.outcome === 'pending' && !blocked.has(r.sessionId) && r.nextAttempt <= now,
      );
    },
    failure(row, status, retryAfter = 0) {
      return mutate((rows) => {
        const current = rows.items.find((r) => r.id === row.id);
        if (!current || current.outcome !== 'pending') return;
        current.attempts++;
        current.error = status;
        current.nextAttempt =
          Date.now() +
          Math.max(
            retryAfter,
            Math.min(60000, 1000 * 2 ** Math.min(current.attempts, 6)) *
              (0.8 + Math.random() * 0.4),
          );
        if ([401, 403, 404, 409, 410, 413, 415].includes(status)) current.outcome = 'blocked';
      });
    },
    retry(sessionId) {
      return mutate((rows) => {
        for (const row of rows.items)
          if (
            (!sessionId || row.sessionId === sessionId) &&
            (row.outcome === 'blocked' || row.outcome === 'pending')
          ) {
            row.outcome = 'pending';
            row.nextAttempt = 0;
          }
      });
    },
    discard(sessionId) {
      return mutate((rows) => {
        for (const row of rows.items)
          if (row.sessionId === sessionId && row.outcome !== 'received') {
            row.outcome = 'discarded';
            row.body = null;
          }
        for (const g of rows.groups) if (g.sessionId === sessionId) g.discarded = true;
      });
    },
    deleteSession(sessionId) {
      return mutate((rows) => {
        rows.items = rows.items.filter((row) => row.sessionId !== sessionId);
        rows.groups = rows.groups.filter((row) => row.sessionId !== sessionId);
        rows.starts = rows.starts.filter(
          (row) => row.ack?.sessionId !== sessionId && row.sessionId !== sessionId,
        );
        rows.starts.push({ id: `deleted/${sessionId}`, sessionId, outcome: 'discarded' });
      });
    },
    group(value) {
      return mutate((rows) => {
        const prior = rows.groups.find((g) => g.id === value.id);
        if (prior) Object.assign(prior, value);
        else rows.groups.push(value);
      });
    },
    async prepareStart(metadata) {
      const requestId = crypto.randomUUID(),
        body = JSON.stringify({ requestId, metadata }),
        hash = await captureDigest(encoder.encode(body));
      return mutate((rows) => {
        const row = {
          id: requestId,
          requestId,
          bodyText: body,
          requestHash: hash,
          outcome: 'pending',
        };
        rows.starts.push(row);
        return row;
      });
    },
    acceptStart(start, ack) {
      if (
        ack?.protocolVersion !== 2 ||
        ack.requestId !== start.requestId ||
        ack.requestHash !== start.requestHash ||
        !/^[a-f0-9]{32}$/.test(ack.sessionId || '')
      )
        return Promise.reject(Error('Creation receipt mismatch'));
      return mutate((rows) => {
        const row = rows.starts.find((r) => r.id === start.id);
        if (!row || row.requestHash !== start.requestHash) throw Error('Creation unavailable');
        if (row.ack && JSON.stringify(row.ack) !== JSON.stringify(ack))
          throw Error('Creation receipt conflict');
        row.ack = ack;
        row.outcome = 'received';
      });
    },
  };
}
