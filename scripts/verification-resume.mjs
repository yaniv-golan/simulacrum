import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
const canonical = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
import { CHAIN_DEPTH_LIMIT } from './candidate-after.mjs';
/** True when `row` ({payload, signature}) was written under `key`; the ledger and any reader
 * outside it (a release citing a parent's leaf) share this one check. */
export function verifyLeafRow(row, key) {
  if (!row || typeof row !== 'object' || typeof row.signature !== 'string') return false;
  const a = Buffer.from(row.signature, 'hex'),
    b = createHmac('sha256', key).update(canonical(row.payload)).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}
/** Reads a leaf row with the ledger's own rules: a regular file of at most 5 MiB whose signature
 * verifies under `key`; null when absent; throws on an invalid or tampered artifact. */
export function readLeafRow(path, key) {
  let text;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw Error('invalid leaf artifact');
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const row = JSON.parse(text);
  if (!verifyLeafRow(row, key)) throw Error('resume receipt integrity failure');
  return row;
}
/** Local key is held outside source. This detects modified receipts, not a hostile same-UID key owner.
 * `eligible` gates loads; `saveEligible` (a predicate, a list, or null for every leaf) gates saves
 * so a diagnosed retry can reuse leaves a plain resume never reads. `origin` names the attempt that produced fresh leaves.
 * `accept(payload)` inspects a receipt's retained evidence before it is offered: 'ok', 'missing'
 * (the leaf executes again) or anything else (fails closed). */
export function createLeafLedger({
  directory,
  key,
  identity,
  eligible,
  saveEligible,
  origin = null,
  accept = null,
}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('32-byte local resume key required');
  const allowed = new Set(eligible),
    savable =
      typeof saveEligible === 'function'
        ? saveEligible
        : saveEligible === null
          ? () => true
          : (id) => new Set(saveEligible ?? eligible).has(id),
    identityKey = canonical(identity);
  const path = (id) => join(directory, createHash('sha256').update(id).digest('hex') + '.json');
  const signature = (payload) => createHmac('sha256', key).update(canonical(payload)).digest();
  return {
    path,
    load(id, configuration) {
      if (!allowed.has(id)) return null;
      const row = readLeafRow(path(id), key);
      if (!row) return null;
      const p = row.payload;
      if (p.id !== id || p.identity !== identityKey || p.configuration !== canonical(configuration))
        return null;
      if (p.status !== 'passed') return null;
      if (!Number.isFinite(p.elapsedMs) || p.elapsedMs < 0 || p.value?.code !== 0)
        throw Error('invalid resumed result');
      // Evidence carried through too many retries is not offered again.
      if (p.origin && !(Number.isInteger(p.origin.depth) && p.origin.depth < CHAIN_DEPTH_LIMIT))
        return null;
      if (accept) {
        const verdict = accept(p);
        if (verdict === 'missing') return null;
        if (verdict !== 'ok') throw Error(`resume receipt evidence ${verdict}: ${id}`);
      }
      return p;
    },
    save(id, configuration, value, elapsedMs, leafOrigin = null) {
      if (!savable(id)) return;
      if (value?.code !== 0) throw Error('only successful process leaves may be saved');
      const payload = {
        id,
        identity: identityKey,
        configuration: canonical(configuration),
        status: 'passed',
        value,
        elapsedMs,
        ...(leafOrigin
          ? { origin: leafOrigin }
          : origin
            ? { origin: { attempt: origin.attempt, report: origin.report, depth: 0 } }
            : {}),
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
