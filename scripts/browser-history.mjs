import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Scheduling hints only. No history row can authorize omission or receipt reuse.
export function readBrowserHistory(path) {
  const rows = new Map();
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    for (const row of Array.isArray(value.runs) ? value.runs : []) {
      if (typeof row.id !== 'string' || !/^[a-z0-9-]+$/.test(row.id) || typeof row.ok !== 'boolean')
        continue;
      rows.set(row.id, {
        id: row.id,
        ok: row.ok,
        ...(Number.isFinite(row.elapsedMs) && row.elapsedMs > 0
          ? { elapsedMs: row.elapsedMs }
          : {}),
      });
    }
  } catch {
    /* Missing or malformed history does not change coverage. */
  }
  return rows;
}
export function writeBrowserHistory(path, runs) {
  const rows = readBrowserHistory(path);
  for (const row of runs) {
    if (typeof row.ok !== 'boolean') continue;
    rows.set(row.id, {
      id: row.id,
      ok: row.ok,
      ...(row.ok && Number.isFinite(row.elapsedMs) && row.elapsedMs > 0
        ? { elapsedMs: row.elapsedMs }
        : {}),
    });
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ runs: [...rows.values()] }) + '\n');
  renameSync(temporary, path);
}
