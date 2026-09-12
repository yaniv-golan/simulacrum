import {
  readFileSync,
  readdirSync,
  lstatSync,
  readlinkSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
/** Complete installed bytes, including symlink targets. No cross-install cache inference. */
export function dependencyDigest(root) {
  const base = realpathSync(resolve(root, 'node_modules')),
    hash = createHash('sha256');
  function visit(dir) {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name),
        stat = lstatSync(p),
        rel = relative(base, p);
      const record = { path: rel, mode: stat.mode & 0o777 };
      if (stat.isSymbolicLink()) {
        const target = realpathSync(p);
        if (!target.startsWith(base + '/'))
          throw Error('installed dependency escapes node_modules');
        hash.update(JSON.stringify({ ...record, type: 'link', target: readlinkSync(p) }) + '\n');
      } else if (stat.isDirectory()) {
        hash.update(JSON.stringify({ ...record, type: 'directory' }) + '\n');
        visit(p);
      } else if (stat.isFile())
        hash.update(
          JSON.stringify({
            ...record,
            type: 'file',
            sha256: createHash('sha256').update(readFileSync(p)).digest('hex'),
          }) + '\n',
        );
      else throw Error('unsupported dependency input');
    }
  }
  visit(base);
  return hash.digest('hex');
}
export function writeResumeDescriptor(directory, payload, key) {
  const text = JSON.stringify(payload);
  writeFileSync(
    join(directory, 'resume-descriptor.json'),
    JSON.stringify({ text, signature: createHmac('sha256', key).update(text).digest('hex') }),
    { mode: 0o600 },
  );
}
export function readResumeDescriptor(directory, key) {
  const row = JSON.parse(readFileSync(join(directory, 'resume-descriptor.json'), 'utf8'));
  const a = Buffer.from(row.signature ?? '', 'hex'),
    b = createHmac('sha256', key).update(row.text).digest();
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw Error('candidate resume descriptor integrity failure');
  return JSON.parse(row.text);
}
