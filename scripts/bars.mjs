// Every bar is red until its milestone implements it. M0 requires only that
// they exist, are named, and fail. See AGENTS.md.
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);
const requested = process.argv[2];
const bars = requested ? { [requested]: manifest.bars[requested] } : manifest.bars;

if (requested && !manifest.bars[requested]) {
  console.error(`unknown bar: ${requested}`);
  process.exit(2);
}

for (const [id, contract] of Object.entries(bars)) {
  console.error(`RED  ${id}  ${contract}`);
}
console.error(
  `\n${Object.keys(bars).length} bar(s) red. This is correct until their milestone.`,
);
process.exit(1);
