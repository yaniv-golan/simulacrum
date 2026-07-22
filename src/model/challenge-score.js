import { finiteOr } from "./finite-or.js";

export function scoreChallengeResult({
  elapsedS,
  initialEnergyWh,
  machine,
  damage,
}) {
  const energyUsed = Math.max(
      0,
      finiteOr(initialEnergyWh) - finiteOr(machine.energy),
    ),
    breakdown = {
      completion: 10000,
      time: -Math.round(finiteOr(elapsedS) * 12),
      mass: -Math.round(finiteOr(machine.mass) * 1.4),
      complexity: -Math.round(finiteOr(machine.partCount) * 18),
      energy: -Math.round(energyUsed * 8),
      damage: -Math.round(
        finiteOr(damage.failed) * 900 + finiteOr(damage.detached) * 240,
      ),
    },
    score = Math.max(
      100,
      Object.values(breakdown).reduce((sum, value) => sum + value, 0),
    );
  return { score, breakdown, energyUsed };
}
