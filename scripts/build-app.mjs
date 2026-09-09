import { build } from 'vite';
import { checkBreadth } from './check-breadth.mjs';
checkBreadth();
await build();
