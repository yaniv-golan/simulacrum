/** Follow the public catalog journey, including its nonmutating preview. */
export async function browseAllParts(page) {
  const search = page.getByRole('searchbox', { name: 'Search all parts' });
  if (!(await search.isVisible()))
    await page.getByRole('button', { name: 'Expand parts', exact: true }).click();
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
