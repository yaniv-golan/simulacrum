import { controllerDecision } from '../model/controller-decision.mjs';
import { immutableCopy } from '../model/observation.mjs';
/** Bounded recent diagnostics, separate from training and simulation state. */
export function createControllerHistory() {
  const runs = [];
  let epoch = null,
    lastTick = -1;
  return {
    ingest(observation) {
      if (!observation.ok) return;
      for (const frame of observation.frames ?? []) {
        if (frame.metadata.mode !== 'run' || frame.tick < 1) continue;
        if (epoch !== observation.cursor?.epoch || frame.tick < lastTick || !runs.length) {
          epoch = observation.cursor?.epoch;
          lastTick = -1;
          runs.push({ rows: [], faults: [] });
          if (runs.length > 4) runs.shift();
        }
        if (frame.tick <= lastTick) continue;
        lastTick = frame.tick;
        const run = runs.at(-1);
        for (const part of frame.metadata.blueprint.parts) {
          if (!['logicController', 'learningController'].includes(part.type)) continue;
          const row = controllerDecision(frame, part.id);
          run.rows.push(row);
          if (run.rows.length > 600) run.rows.shift();
          const fault =
            row.error ||
            row.inputs.some((i) => ['no-power', 'unavailable', 'disconnected'].includes(i.status));
          if (
            fault &&
            !run.faults.some((r) => r.controller === row.controller) &&
            run.faults.length < 32
          )
            run.faults.push(row);
        }
      }
    },
    read(blueprint, controller) {
      return immutableCopy(
        runs.flatMap((run, index) =>
          [...new Set([...run.faults, ...run.rows])]
            .filter((r) => r.blueprint === blueprint && r.controller === controller)
            .sort((a, b) => a.tick - b.tick)
            .map((r) => ({ ...r, run: index + 1 })),
        ),
      );
    },
    clear() {
      runs.length = 0;
      epoch = null;
      lastTick = -1;
    },
  };
}
