import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Scheduling hints only. No history row can authorize omission or receipt reuse.
function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
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
    ...(typeof row.observationId === 'string' ? { observationId: row.observationId } : {}),
    ...(row.ok && Number.isFinite(row.elapsedMs) && row.elapsedMs > 0
      ? { elapsedMs: row.elapsedMs }
      : {}),
  };
}
function records(path) {
  const directory = `${path}.observations`;
  let names;
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  return names
    .filter((name) => /^[a-f0-9-]+\.json$/.test(name))
    .flatMap((name) => {
      const file = join(directory, name),
        row = normalize(readJSON(file));
      return row ? [{ file, row }] : [];
    });
}
function compare(a, b) {
  return (
    (a.observedAt ?? 0) - (b.observedAt ?? 0) ||
    Number(b.ok) - Number(a.ok) ||
    (a.observationId ?? '').localeCompare(b.observationId ?? '')
  );
}
export function readBrowserHistory(path) {
  const rows = new Map(),
    snapshot = readJSON(path);
  for (const input of [
    ...(Array.isArray(snapshot.runs) ? snapshot.runs : []),
    ...records(path).map((r) => r.row),
  ]) {
    const row = normalize(input);
    if (row && (!rows.has(row.id) || compare(row, rows.get(row.id)) > 0)) rows.set(row.id, row);
  }
  return rows;
}
function publish(path, value) {
  const temporary = join(dirname(path), `.browser-history-${process.pid}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(value) + '\n');
    renameSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
function removeAbandonedTemps(directory) {
  for (const name of readdirSync(directory)) {
    const match = /^\.browser-history-([1-9][0-9]*)-[a-f0-9-]+\.tmp$/.exec(name);
    if (!match) continue;
    try {
      process.kill(Number(match[1]), 0);
    } catch (error) {
      // EPERM and uncertain ownership retain the file. PID reuse can delay
      // reclamation, but never permits deletion of a live writer's temporary.
      if (error.code !== 'ESRCH') continue;
      try {
        unlinkSync(join(directory, name));
      } catch (failure) {
        if (failure.code !== 'ENOENT') throw failure;
      }
    }
  }
}
export function writeBrowserHistory(path, runs) {
  const directory = `${path}.observations`;
  mkdirSync(directory, { recursive: true });
  removeAbandonedTemps(directory);
  removeAbandonedTemps(dirname(path));
  for (const input of runs) {
    const row = normalize(input);
    if (!row) continue;
    row.observedAt ??= performance.timeOrigin + performance.now();
    row.observationId ??= randomUUID();
    // Immutable observations survive interrupted or competing snapshot publishers.
    publish(join(directory, `${randomUUID()}.json`), row);
  }
  // Compatibility snapshot for older frozen candidates. Current readers also merge
  // immutable records, so a delayed snapshot cannot erase newer observations.
  publish(path, { runs: [...readBrowserHistory(path).values()] });
  const groups = new Map();
  for (const record of records(path)) {
    const group = groups.get(record.row.id) ?? [];
    group.push(record);
    groups.set(record.row.id, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => compare(b.row, a.row) || b.file.localeCompare(a.file));
    // Prune only records with two already-published newer witnesses. Concurrent
    // pruning preserves the maximum; an interrupted writer leaves no blocking lock.
    for (const { file } of group.slice(2)) {
      try {
        unlinkSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
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
      observationId: `${report.runId}:${row.id}`,
    }));
  if (outcomes.length) writeBrowserHistory(origin, outcomes);
}
