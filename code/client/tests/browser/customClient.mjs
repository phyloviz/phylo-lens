import assert from 'node:assert/strict';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from './browserRuntime.mjs';

const root = process.argv[2];
if (!root) throw new Error('Pass the external host directory containing the installed package tarball.');
const fixtureRoot = await realpath(root);
await access(join(fixtureRoot, 'src/main.ts'));
const cacheDir = await mkdtemp(join(tmpdir(), 'phylo-lens-custom-browser-'));
let server, browser;
try {
  server = await createServer({
    root: fixtureRoot,
    configFile: false,
    cacheDir,
    server: { host: '127.0.0.1', port: 0, fs: { allow: [fixtureRoot] } },
  });
  await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const apiRequests = [],
    errors = [];
  page.on('request', request => {
    if (/^\/(health|api)(\/|$)/.test(new URL(request.url()).pathname)) apiRequests.push(request.url());
  });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByText('Ready · custom client · no API service', { exact: true }).waitFor();
  assert.ok((await page.locator('#tree canvas').count()) > 0);
  await page.locator('#find').click();
  await page.getByText('Selected PT-02.', { exact: true }).waitFor();
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  assert.equal((await download).suggestedFilename(), 'phylo-lens-custom-client.png');
  assert.deepEqual(apiRequests, []);
  assert.deepEqual(errors, []);
  console.log('Packed custom-client browser: render, search, focus and PNG export passed without API requests.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(cacheDir, { recursive: true, force: true });
}
