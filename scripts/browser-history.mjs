import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Optional ordering hints, never receipt authority. Concurrent last-writer-wins
// updates may lose hints; accepting that is cheaper than coordinating publishers.
function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) ?? {};
  } catch {
    return {};
  }
}
function normalize(row) {
  if (typeof row?.id !== 'string' || !/^[a-z0-9-]+$/.test(row.id) || typeof row.ok !== 'boolean')
    return null;
  return {
    id: row.id,
    ok: row.ok,
    ...(Number.isFinite(row.observedAt) && row.observedAt > 0
      ? { observedAt: row.observedAt }
      : {}),
    ...(row.ok && Number.isFinite(row.elapsedMs) && row.elapsedMs > 0
      ? { elapsedMs: row.elapsedMs }
      : {}),
  };
}
export function readBrowserHistory(path) {
  const snapshot = readJSON(path),
    rows = new Map();
  for (const input of Array.isArray(snapshot.runs) ? snapshot.runs : []) {
    const row = normalize(input);
    if (row) rows.set(row.id, row);
  }
  return rows;
}
export function writeBrowserHistory(path, runs) {
  const rows = readBrowserHistory(path);
  for (const input of runs) {
    const row = normalize(input);
    if (!row) continue;
    row.observedAt ??= performance.timeOrigin + performance.now();
    const current = rows.get(row.id);
    if (
      current?.observedAt > row.observedAt ||
      (current?.observedAt === row.observedAt && !current.ok && row.ok)
    )
      continue;
    rows.set(row.id, row);
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ runs: [...rows.values()] }) + '\n');
    renameSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export function browserHistoryRunId(reportPath) {
  return readJSON(reportPath).runId;
}
export function returnBrowserHistory(origin, reportPath, previousRunId) {
  const report = readJSON(reportPath);
  if (
    typeof report.runId !== 'string' ||
    report.runId === previousRunId ||
    !Array.isArray(report.runs)
  )
    return;
  const startedAt = Date.parse(report.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return;
  const outcomes = report.runs
    .filter((row) => !row.reused && typeof row.ok === 'boolean')
    .map((row) => ({
      ...row,
      // Older frozen runners lack per-check completion times. Their suite start is
      // a conservative lower bound, never the time a delayed candidate returns.
      observedAt: row.observedAt ?? startedAt,
    }));
  if (outcomes.length) writeBrowserHistory(origin, outcomes);
}
