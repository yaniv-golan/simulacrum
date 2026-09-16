/** Follow the public catalog journey, including its nonmutating preview. */
export async function browseAllParts(page) {
  const search = page.getByRole('searchbox', { name: 'Search all parts' });
  // + Add part summons the parts overlay from anywhere on the bench (P does the same).
  if (!(await search.isVisible())) await page.locator('[data-command=add-part]').click();
  await page.getByRole('button', { name: 'All parts', exact: true }).click();
}
export async function placeCatalogPart(page, type, place = (target) => target.click()) {
  await browseAllParts(page);
  // Previewing does not author a command or produce a placement metric.
  await page.locator(`[data-part-type="${type}"]`).click();
  await place(page.getByRole('button', { name: 'Place part', exact: true }));
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}

export async function placeCatalogPartByName(page, name) {
  await browseAllParts(page);
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Place part', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}

/** Open the header's Tools menu, where the occasional commands live; idempotent. */
export async function openTools(page) {
  const menu = page.locator('details.tools-menu');
  if (!(await menu.evaluate((node) => node.open))) await menu.locator('summary').click();
}

/**
 * Open one Learn & examples row so its instruction and the extra actions inside it are
 * reachable. A row's own launcher stays beside its name while the row is closed, so only
 * content inside the row needs this. Idempotent.
 */
export async function expandExample(page, id) {
  const toggle = page.locator(`.example-card[data-example="${id}"] .example-toggle`);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.locator(`#example-detail-${id}`).waitFor({ state: 'visible' });
}

/** Open the optional sensor-variant disclosure that lives inside an expanded row. */
export async function expandExampleVariants(page, id) {
  await expandExample(page, id);
  const variants = page.locator(`#example-detail-${id} .example-variants`);
  if (!(await variants.evaluate((node) => node.open))) await variants.locator('summary').click();
}
