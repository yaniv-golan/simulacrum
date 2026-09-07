import { readManifest } from './validate-manifest.mjs';
import { explainInvariant } from './invariant-coverage.mjs';
const manifest = readManifest();
const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('Usage: node scripts/explain-invariant.mjs <invariant-id|--list>');
  process.exitCode = 1;
} else if (args[0] === '--list')
  console.log(manifest.invariants.map((x) => `${x.id}: ${x.guarantee}`).join('\n'));
else {
  try {
    console.log(JSON.stringify(explainInvariant(manifest, args[0]), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
