/**
 * Every numeric Stryker range must select real lines of the file it names.
 *
 * A range past end-of-file selects nothing, so the profile generates zero
 * mutants for that file and still reports green off its other entries. That is
 * indistinguishable from a passing run, and it is how
 * stryker.model-boundaries.config.json carried a dead
 * blueprint-decoder.js:473-565 anchor for five weeks across a public release:
 * the file was already 322 lines when the range was authored, so it never
 * selected a line in its entire life.
 *
 * Stryker itself cannot catch this - its options validator checks only
 * start >= 1 and start < end, never the file length - so the check lives here
 * and runs at authoring time rather than in a periodic re-anchoring sweep.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, ".."),
  entries = await fs.readdir(root),
  configs = entries.filter((name) => /^stryker\..*\.config\.json$/.test(name)),
  failures = [];
let numericRanges = 0;

assert.ok(configs.length > 0, "expected at least one Stryker configuration");

const lineCounts = new Map();
async function lineCountOf(relativePath) {
  if (!lineCounts.has(relativePath)) {
    const target = path.join(root, relativePath);
    let count;
    try {
      count = (await fs.readFile(target, "utf8")).split(/\r?\n/).length;
    } catch {
      count = null;
    }
    lineCounts.set(relativePath, count);
  }
  return lineCounts.get(relativePath);
}

for (const config of configs) {
  const parsed = JSON.parse(await fs.readFile(path.join(root, config), "utf8"));
  for (const spec of parsed.mutate ?? []) {
    const match = /^(.*?):(\d+)(?:-(\d+))?$/.exec(spec);
    if (!match) {
      const whole = await lineCountOf(spec);
      if (whole === null)
        failures.push(`${config}: ${spec} names a missing file`);
      continue;
    }
    numericRanges += 1;
    const [, relativePath, rawStart, rawEnd] = match,
      start = Number(rawStart),
      end = rawEnd ? Number(rawEnd) : start,
      lines = await lineCountOf(relativePath);
    if (lines === null) {
      failures.push(`${config}: ${spec} names a missing file`);
      continue;
    }
    if (start > lines)
      failures.push(
        `${config}: ${spec} starts past end of file (${lines} lines); it selects nothing and generates zero mutants`,
      );
    else if (end > lines)
      failures.push(
        `${config}: ${spec} ends past end of file (${lines} lines); clamp it to the real range`,
      );
  }
}

assert.deepEqual(
  failures,
  [],
  `mutation anchors must select real lines:\n${failures.join("\n")}`,
);

console.log(
  `mutation anchors verified (${configs.length} configs, ${numericRanges} numeric ranges, all in range)`,
);
