import { placeCatalogPart } from './catalog-browser-actions.mjs';

export const readLoadCellFrame = (page) =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));

export async function selectLoadCellPart(page, part) {
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator(`.part-list-item[data-part-id="${part.id}"]`).click();
}

export async function placeLoadCellControl(page, type, position) {
  await placeCatalogPart(page, type, async (place) => {
    const panel = page.getByRole('region', { name: 'Place part', exact: true });
    await panel.getByText('Precise position', { exact: true }).click();
    for (const [i, axis] of ['X', 'Y', 'Z'].entries())
      await panel.getByLabel(`${axis} position`, { exact: true }).fill(String(position[i]));
    await place.click();
  });
  return (await readLoadCellFrame(page)).metadata.blueprint.parts.at(-1);
}

export async function wireLoadCellPart(page, source, port, target, targetPort) {
  await selectLoadCellPart(page, source);
  const button = page.locator(`[data-port-id="${port}"]`);
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await page
    .getByRole('button', {
      name: `Wire ${target.name} · ${targetPort} (parts stay put)`,
      exact: true,
    })
    .click();
}
