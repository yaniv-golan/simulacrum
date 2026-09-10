import { createBrowserEvidence } from './browser-evidence.mjs';
import { runAssemblyCases } from './assembly-ux-cases.mjs';
const evidence = createBrowserEvidence();
const browser = await evidence.launch({ profile: 'ui' });
await runAssemblyCases(1, evidence, browser);
