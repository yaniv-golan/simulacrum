import type { MotionFrame } from '../../src/model/motor-shaft-speed.mjs';
declare const frame: MotionFrame;
frame.metadata.blueprint.parts.push(frame.metadata.blueprint.parts[0]);
