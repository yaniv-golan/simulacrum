import assert from "node:assert/strict";

export { assert };

export function assertNoErrors(errors, label = "browser") {
  assert.deepEqual(
    errors,
    [],
    `${label} emitted browser errors:\n${errors.join("\n")}`,
  );
}

export async function closeBrowser(browser) {
  if (!browser) return;
  await Promise.race([
    browser.close(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

export async function conclude(browser, assertions) {
  let failure = null;
  try {
    assertions();
  } catch (error) {
    failure = error;
    console.error(error);
  }
  await closeBrowser(browser);
  process.exit(failure ? 1 : 0);
}
