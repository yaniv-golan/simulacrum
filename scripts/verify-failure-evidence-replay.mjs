import fs from "node:fs";
import process from "node:process";
import { verifyFailureEvidenceReplay } from "../src/application/failure-evidence-replay.js";

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write(
    "usage: node scripts/verify-failure-evidence-replay.mjs <artifact.json>\n",
  );
  process.exitCode = 2;
} else {
  try {
    const result = await verifyFailureEvidenceReplay(
      JSON.parse(fs.readFileSync(inputPath, "utf8")),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.reproduced) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          reproduced: false,
          error: error instanceof Error ? error.message : String(error),
          code: error?.code || null,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 2;
  }
}
