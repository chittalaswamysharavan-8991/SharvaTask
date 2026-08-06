import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = 'https://sharvatask-akstt36rn-chittalaswamysharavan-7613s-projects.vercel.app/?_vercel_share=M7oNRgzdvMVUvEusIV5VFnkNqHpjU2LG';
const origin = new URL(baseUrl).origin;
const temporaryAccessKey = 'ST-TEMP-UMM73VDGVGTRPG9W';
const knownPrivateTask = 'SharvaOS V1 — 18-Hour Completion Run';
const outDir = 'control-center-preview-qa';
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const evidence = {
  verdict: 'FAIL',
  origin,
  checkedAt: new Date().toISOString(),
  unauthenticated: {},
  desktop: {},
  mobile: {},
  errors: []
};

function attachErrorCapture(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') evidence.errors.push(`${label} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => evidence.errors.push(`${label} page: ${error.message}`));
}

async function openProtectedPreview(page) {
  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  assert.equal(response?.status(), 200);
  await page.getByRole('heading', { name: 'SharvaTask Control Center' }).waitFor({ timeout: 30_000 });
  await page.getByText('Enter the private access key to continue.').waitFor({ timeout: 30_000 });
}

async function unlock(page) {
  await page.locator('input[type="password"]').fill(temporaryAccessKey);
  await page.getByRole('button', { name: 'Open control center' }).click();
  await page.getByRole('heading', { name: 'Control Center' }).waitFor({ timeout: 45_000 });
  await page.locator('.list-hero').waitFor({ timeout: 45_000 });
}

try {
  const unauthContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const unauthPage = await unauthContext.newPage();
  attachErrorCapture(unauthPage, 'unauthenticated');
  await openProtectedPreview(unauthPage);

  const unauthBody = await unauthPage.locator('body').innerText();
  const source = await unauthPage.content();
  assert.match(unauthBody, /SharvaTask Control Center/);
  assert.match(unauthBody, /Enter the private access key/);
  assert.doesNotMatch(unauthBody, new RegExp(knownPrivateTask));
  assert.doesNotMatch(source, new RegExp(knownPrivateTask));
  const apiResponse = await unauthContext.request.get(`${origin}/api/control-center`);
  assert.equal(apiResponse.status(), 401);
  await unauthPage.screenshot({ path: `${outDir}/locked-desktop.png`, fullPage: true });
  evidence.unauthenticated = {
    pageStatus: 200,
    apiStatus: apiResponse.status(),
    privateTaskVisible: false
  };
  await unauthContext.close();

  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const desktopPage = await desktopContext.newPage();
  attachErrorCapture(desktopPage, 'desktop');
  await openProtectedPreview(desktopPage);
  await unlock(desktopPage);
  await desktopPage.getByText(knownPrivateTask, { exact: true }).first().waitFor();
  const desktopOverflow = await desktopPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(desktopOverflow <= 1, `Desktop horizontal overflow: ${desktopOverflow}`);
  const pendingTask = desktopPage.locator('.task-row').filter({ has: desktopPage.locator('.status-badge.pending') }).first();
  await pendingTask.click();
  await desktopPage.getByRole('heading', { name: 'Task details' }).waitFor();
  assert.ok(await desktopPage.getByRole('button', { name: 'Lock' }).isVisible());
  await desktopPage.screenshot({ path: `${outDir}/control-center-desktop.png`, fullPage: true });
  evidence.desktop = {
    viewport: '1440x1000',
    horizontalOverflow: desktopOverflow,
    inspectorOpened: true,
    lockVisible: true
  };
  await desktopPage.getByRole('button', { name: 'Lock' }).click();
  await desktopPage.getByRole('heading', { name: 'SharvaTask Control Center' }).waitFor({ timeout: 30_000 });
  await desktopContext.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobileContext.newPage();
  attachErrorCapture(mobilePage, 'mobile');
  await openProtectedPreview(mobilePage);
  await unlock(mobilePage);
  const mobileOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(mobileOverflow <= 1, `Mobile horizontal overflow: ${mobileOverflow}`);
  await mobilePage.getByRole('button', { name: 'Open navigation' }).click();
  await mobilePage.locator('.sidebar-open').waitFor();
  await mobilePage.screenshot({ path: `${outDir}/control-center-mobile.png`, fullPage: true });
  evidence.mobile = {
    viewport: '390x844',
    horizontalOverflow: mobileOverflow,
    sidebarOpened: true
  };
  await mobileContext.close();

  assert.deepEqual(evidence.errors, []);
  evidence.verdict = 'PASS';
} catch (error) {
  evidence.errors.push(error instanceof Error ? error.stack || error.message : String(error));
  throw error;
} finally {
  await writeFile(`${outDir}/result.json`, JSON.stringify(evidence, null, 2));
  await browser.close();
  console.log(JSON.stringify(evidence, null, 2));
}
