import * as THREE from "three";

/** Projects canonical pneumatic telemetry and renders bounded static flow arrows. */
export function createPneumaticTelemetryPresenter({ parts, effects }) {
  const overlay = new THREE.Group();
  overlay.name = "pneumaticFlowOverlay";
  effects.add(overlay);
  let transactionId = null;

  function clear() {
    for (const child of [...overlay.children]) {
      overlay.remove(child);
      child.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material))
          object.material.forEach((material) => material.dispose?.());
        else object.material?.dispose?.();
      });
    }
    transactionId = null;
  }

  function projectChambers(telemetry) {
    for (const chamber of telemetry?.chambers || []) {
      const part = parts().find((candidate) => candidate.id === chamber.partId);
      if (!part) continue;
      part.tireAbsolutePressurePa = chamber.absolutePressurePa;
      part.tireGaugePressurePa = chamber.gaugePressurePa;
      part.tireGasTemperatureK = chamber.temperatureK;
      part.tireGasMassKg = chamber.gasMassKg;
      part.tireMassInKg = chamber.massInKg;
      part.tireMassOutKg = chamber.massOutKg;
      part.tirePneumaticTransactionId = telemetry.transactionId;
      part.tirePneumaticFailureMode = chamber.failureMode;
    }
  }

  function position(partId) {
    return parts()
      .find(({ id }) => id === partId)
      ?.mesh?.getWorldPosition(new THREE.Vector3());
  }

  function addArrow(transfer) {
    const sourcePosition = position(transfer.sourcePartId),
      destinationPosition = position(transfer.destinationPartId),
      start = sourcePosition
        ? sourcePosition
        : destinationPosition?.clone().add(new THREE.Vector3(0, 0.8, 0)),
      end = destinationPosition
        ? destinationPosition
        : sourcePosition?.clone().add(new THREE.Vector3(0, 0.8, 0));
    if (!start || !end) return;
    const delta = end.clone().sub(start),
      length = delta.length();
    if (length <= 1e-6) return;
    const color =
        transfer.kind === "damage-leak-v1"
          ? 0xff5c5c
          : transfer.destinationPartId == null
            ? 0xffa24d
            : 0x55d7ff,
      arrow = new THREE.ArrowHelper(
        delta.normalize(),
        start,
        length,
        color,
        Math.min(0.22, length * 0.25),
        Math.min(0.12, length * 0.14),
      );
    arrow.name = `pneumaticFlow:${transfer.transactionId}:${transfer.sourcePartId ?? "ambient"}:${transfer.destinationPartId ?? "ambient"}`;
    arrow.userData = {
      deliveredMassKg: transfer.deliveredMassKg,
      limitingReason: transfer.limitingReason,
    };
    overlay.add(arrow);
  }

  function present(telemetry) {
    projectChambers(telemetry);
    if (telemetry?.transactionId === transactionId) return;
    clear();
    transactionId = telemetry?.transactionId ?? null;
    for (const transfer of telemetry?.transfers || [])
      if (transfer.deliveredMassKg > 0) addArrow(transfer);
  }

  return Object.freeze({ clear, present });
}
