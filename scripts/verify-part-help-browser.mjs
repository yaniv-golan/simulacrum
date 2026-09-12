import { createBrowserEvidence } from './browser-evidence.mjs';
import { runPartHelpCases } from './part-help-cases.mjs';
const evidence = createBrowserEvidence();
const browser = await evidence.launch({ profile: 'ui' });
await runPartHelpCases(0, evidence, browser);
