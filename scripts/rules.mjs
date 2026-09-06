import {readManifest} from './validate-manifest.mjs';
const manifest=readManifest();
const checks=[...manifest.checks,...Object.values(manifest.exitObligations).flat(),...(manifest.browserChecks??[])];
for(const rule of manifest.rules){const owners=checks.filter(c=>c.ruleId===rule.id&&(c.module||c.script||c.check)).map(c=>c.id);console.log(`${rule.id} | ${rule.rule} | ${owners.length?[...new Set(owners)].join(', '):'UNENFORCED'}`);}
