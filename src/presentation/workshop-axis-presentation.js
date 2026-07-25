import { WORKSHOP_AXIS_CONVENTION } from "../model/workshop-axis-convention.js";

/** @type {Readonly<Record<string,string>>} */
const colors = Object.freeze({ x: "#e06b65", y: "#72c58a", z: "#669cf0" });

/** @type {ReadonlyArray<Readonly<{id:string,index:number,positive:string,negative:string,letter:string,meaning:string,short:string,color:string,accessibleName:string}>>} */
export const WORKSHOP_AXIS_PRESENTATION = Object.freeze(
  WORKSHOP_AXIS_CONVENTION.axes.map((axis) =>
    Object.freeze({
      ...axis,
      letter: axis.id.toUpperCase(),
      meaning: `${axis.positive.toUpperCase()} / ${axis.negative.toUpperCase()}`,
      short: `${axis.positive[0].toUpperCase()}/${axis.negative[0].toUpperCase()}`,
      color: colors[axis.id],
      accessibleName: `Workshop ${axis.id.toUpperCase()} position, ${axis.positive} positive, metres`,
    }),
  ),
);

export function workshopCoordinateSystemSummary({
  translationSnapM = 0.25,
  rotationSnapDeg = 15,
} = {}) {
  return `meters, ${WORKSHOP_AXIS_CONVENTION.upAxis.toUpperCase()} up, ${translationSnapM}m move snap, ${rotationSnapDeg}deg rotation snap`;
}

export function workshopCoordinateFrames() {
  return {
    version: 1,
    workshopAuthored: {
      axes: WORKSHOP_AXIS_CONVENTION.id,
      units: WORKSHOP_AXIS_CONVENTION.units,
      origin: "workshop-board-center",
      rebased: false,
      fields: [
        "parts[].position",
        "transformGizmo.startPivot",
        "transformGizmo.pivot",
      ],
    },
  };
}
