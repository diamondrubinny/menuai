import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 861;

async function openTab(page: Page, name: RegExp) {
  if (isMobile(page)) await page.getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('tab', { name }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('editor has no detectable accessibility violations', async ({ page }) => {
  for (const tab of [/Content/, /Design/, /Languages/, /Publish/]) {
    await openTab(page, tab);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`), `tab ${tab}`).toEqual([]);
  }
});

test('editing updates the live preview and survives reload', async ({ page }) => {
  await openTab(page, /Content/);
  const title = page.getByLabel('Restaurant / menu name');
  await title.fill('Café Test');
  if (isMobile(page)) await page.getByRole('button', { name: /Preview/ }).click();
  await expect(page.locator('.device-screen .ma-title')).toHaveText('Café Test');
  await page.waitForTimeout(600); // debounced autosave
  await page.reload();
  if (isMobile(page)) await page.getByRole('button', { name: /Edit/ }).click();
  await expect(page.getByLabel('Restaurant / menu name')).toHaveValue('Café Test');
});

test('undo restores the previous theme', async ({ page }) => {
  await openTab(page, /Design/);
  await page.locator('.theme-card', { hasText: 'Neon Night' }).click();
  await expect(page.locator('.device-screen .ma-menu')).toHaveClass(/ma-theme-neon-night/);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.device-screen .ma-menu')).toHaveClass(/ma-theme-noir-gold/);
});

test('exported HTML is self-contained, switches languages and passes axe', async ({ page, browser }) => {
  test.skip(isMobile(page), 'download flow covered on desktop');
  await openTab(page, /Publish/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download menu/ }).click();
  const file = await (await download).path();
  const html = await readFile(file, 'utf8');
  expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // no external requests

  const context = await browser.newContext({ locale: 'he-IL' });
  const viewer = await context.newPage();
  const problems: string[] = [];
  viewer.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  viewer.on('pageerror', (e) => problems.push(e.message));
  await viewer.setContent(html, { waitUntil: 'load' });
  await expect(viewer.locator('[data-ma-lang-root="he"]')).toBeVisible();
  await expect(viewer.locator('[data-ma-lang-root="en"]')).toBeHidden();

  await viewer.locator('[data-ma-lang-root="he"] [data-ma-set-lang="en"]').click();
  await expect(viewer.locator('[data-ma-lang-root="en"]')).toBeVisible();
  await expect(viewer.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(viewer.locator('[data-ma-lang-root="en"] .ma-title')).toHaveText('Lumière');

  const fontsLoaded = await viewer.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').length;
  });
  expect(fontsLoaded).toBeGreaterThan(0);

  const results = await new AxeBuilder({ page: viewer }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  expect(problems).toEqual([]);
});

test('every theme preview has no accessibility violations', async ({ page }) => {
  test.skip(isMobile(page), 'theme matrix runs once');
  test.setTimeout(180_000);
  await openTab(page, /Design/);
  const cards = page.locator('.theme-card');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    await cards.nth(i).click();
    await page.waitForTimeout(300);
    const results = await new AxeBuilder({ page }).include('.device-screen').withTags(['wcag2aa']).analyze();
    const name = await cards.nth(i).innerText();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`), name).toEqual([]);
  }
});

test('view page, accessibility statement and 404 render', async ({ page }) => {
  await page.goto('/#/view?lang=ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.ma-title')).toHaveText('لوميير');
  await page.goto('/#/accessibility');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Accessibility statement');
  await page.goto('/#/nope');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
});

test('"Surprise me" changes the theme and undo restores it', async ({ page }) => {
  await openTab(page, /Design/);
  await page.getByRole('button', { name: /Surprise me/ }).click();
  await expect(page.locator('.device-screen .ma-menu')).not.toHaveClass(/ma-theme-noir-gold/);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.device-screen .ma-menu')).toHaveClass(/ma-theme-noir-gold/);
});
