import { partPrimitives } from '../../src/model/geometry.mjs';
import { part } from './positive.mjs';
partPrimitives({ ...part, parameters: { diameter: 'wide' } });
