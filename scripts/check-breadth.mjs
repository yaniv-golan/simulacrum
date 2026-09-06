import { readManifest } from './validate-manifest.mjs';
import { CATALOG } from '../src/model/catalog.mjs';
import { UI_FEATURES } from '../src/model/features.mjs';
export function checkBreadth(catalog=CATALOG,manifest=readManifest(),features=UI_FEATURES) {
 const cutoff=manifest.milestones.indexOf(manifest.milestone);
 for(const [type,part] of Object.entries({...catalog,...features})) {
  const due=manifest.milestones.indexOf(part.milestone);
  if(due<0||due>cutoff)throw Error(`milestone breadth: ${type} due ${part.milestone}, current ${manifest.milestone}`);
 }
}
