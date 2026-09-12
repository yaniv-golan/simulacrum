import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
const canonical = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
/** Local key is held outside source. This detects modified receipts, not a hostile same-UID key owner. */
export function createLeafLedger({ directory, key, identity, eligible }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('32-byte local resume key required');
  const allowed = new Set(eligible),
    identityKey = canonical(identity);
  const path = (id) => join(directory, createHash('sha256').update(id).digest('hex') + '.json');
  const signature = (payload) => createHmac('sha256', key).update(canonical(payload)).digest();
  return {
    path,
    load(id, configuration) {
      if (!allowed.has(id)) return null;
      let text;
      try {
        const stat = lstatSync(path(id));
        if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw Error('invalid leaf artifact');
        text = readFileSync(path(id), 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
      const row = JSON.parse(text),
        actual = Buffer.from(row.signature ?? '', 'hex');
      const expected = signature(row.payload);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw Error('resume receipt integrity failure');
      const p = row.payload;
      if (p.id !== id || p.identity !== identityKey || p.configuration !== canonical(configuration))
        return null;
      if (p.status !== 'passed') return null;
      if (!Number.isFinite(p.elapsedMs) || p.elapsedMs < 0 || p.value?.code !== 0)
        throw Error('invalid resumed result');
      return p;
    },
    save(id, configuration, value, elapsedMs) {
      if (!allowed.has(id)) return;
      if (value?.code !== 0) throw Error('only successful process leaves may be saved');
      const payload = {
        id,
        identity: identityKey,
        configuration: canonical(configuration),
        status: 'passed',
        value,
        elapsedMs,
      };
      const text = JSON.stringify({ payload, signature: signature(payload).toString('hex') });
      if (Buffer.byteLength(text) > 5 * 1024 * 1024) return;
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const temporary = path(id) + '.tmp';
      writeFileSync(temporary, text, { mode: 0o600 });
      renameSync(temporary, path(id));
    },
  };
}
