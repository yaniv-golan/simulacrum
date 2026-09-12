/** Follow the public catalog journey, including its nonmutating preview. */
export async function browseAllParts(page) {
  const search = page.getByRole('searchbox', { name: 'Search all parts' });
  if (!(await search.isVisible()))
    await page.getByRole('button', { name: 'Expand parts', exact: true }).click();
  await page.getByRole('button', { name: 'All parts', exact: true }).click();
}
export async function placeCatalogPart(page, type, click = (target) => target.click()) {
  await browseAllParts(page);
  await click(page.locator(`[data-part-type="${type}"]`));
  await click(page.getByRole('button', { name: 'Place part', exact: true }));
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}

export async function placeCatalogPartByName(page, name) {
  await browseAllParts(page);
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Place part', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}
