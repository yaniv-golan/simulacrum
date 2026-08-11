import { identityToken } from "./primitives.js";

export function controllerSensorFrameKey(controllerId) {
  return identityToken(controllerId, { typedStrings: true });
}

export function setControllerSensorFrame(frames, controllerId, frame) {
  if (!frames || typeof frames !== "object" || Array.isArray(frames))
    throw new TypeError("controller sensor frames must be a record");
  if (!frame || typeof frame !== "object" || Array.isArray(frame))
    throw new TypeError("controller sensor frame must be a record");
  const key = controllerSensorFrameKey(controllerId);
  if (Object.hasOwn(frames, key))
    throw new TypeError("controller sensor frame ID is duplicated");
  frame.__controllerIdentity = key;
  frames[key] = frame;
  return frames;
}

export function controllerSensorFrameRecord(entries = []) {
  const frames = {};
  for (const [controllerId, frame] of entries)
    setControllerSensorFrame(frames, controllerId, { ...frame });
  return frames;
}

export function controllerSensorFrameForId(frames, controllerId) {
  if (!frames || typeof frames !== "object" || Array.isArray(frames))
    return null;
  const key = controllerSensorFrameKey(controllerId),
    frame = frames[key];
  return frame &&
    typeof frame === "object" &&
    !Array.isArray(frame) &&
    frame.__controllerIdentity === key
    ? frame
    : null;
}
