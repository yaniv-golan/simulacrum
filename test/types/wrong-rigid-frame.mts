import { transformPoseBetweenFrames } from '../../src/model/transforms.mjs';
const frame = { position: [0, 0, 0] as const, rotation: [0, 0, 0, 1] as const };
transformPoseBetweenFrames({ position: [0, 1], rotation: [0, 0, 0, 1] }, frame, frame);
