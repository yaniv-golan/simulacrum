/** @typedef {{id:string,index:number,positive:string,negative:string}} WorkshopAxis */
/** @type {ReadonlyArray<Readonly<WorkshopAxis>>} */
const axes = [
  { id: "x", index: 0, positive: "east", negative: "west" },
  { id: "y", index: 1, positive: "up", negative: "down" },
  { id: "z", index: 2, positive: "north", negative: "south" },
].map((axis) => Object.freeze(axis));

/** Stable authored-axis meaning; contextual origins remain with their owners. */
export const WORKSHOP_AXIS_CONVENTION = Object.freeze({
  id: "x-east-y-up-z-north",
  units: "m",
  groundPlane: Object.freeze(["x", "z"]),
  upAxis: "y",
  axes: Object.freeze(axes),
});
