import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appFingerprint } from './app-fingerprint.mjs';
export { appFingerprint };
// Hashes the WHOLE protocol a participant was judged against, not just the
// one-line contract: the rubric, fixtures, required evidence and scoring rules
// live in assessments/protocol/<bar>.md. Editing the rubric must invalidate
// existing evidence -- hashing only the short contract string left a pass green
// after the instructions changed underneath it.
export function protocolHash(barId, barContract) {
  const hash = createHash('sha256').update(barId).update('\0').update(barContract).update('\0');
  // A missing protocol is not a protocol. Hashing a placeholder let evidence be
  // recorded and stay green with no written instructions at all.
  hash.update(readFileSync(new URL(`../assessments/protocol/${barId}.md`, import.meta.url)));
  return `proto-${hash.digest('hex').slice(0, 12)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(appFingerprint());
