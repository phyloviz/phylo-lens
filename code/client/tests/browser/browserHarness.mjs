import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from './browserRuntime.mjs';

export async function browserHarness({ api, viewport = { width: 1200, height: 800 } } = {}) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'phylo-lens-browser-'));
  let server, browser;
  const close = async () => {
    try {
      await browser?.close();
    } finally {
      try {
        await server?.close();
      } finally {
        await rm(cacheDir, { recursive: true, force: true });
      }
    }
  };
  try {
    server = await createServer({
      root: fileURLToPath(new URL('../../', import.meta.url)),
      configFile: false,
      cacheDir,
      optimizeDeps: { include: ['d3-force', 'sigma', 'graphology'] },
      server: {
        host: '127.0.0.1',
        port: 0,
        watch: { ignored: ['**/*'] },
        proxy: api ? { '/api': api, '/health': api } : undefined,
      },
    });
    await server.listen();
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      headless: true,
      args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
    });
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    return { page, errors, close, url: `http://127.0.0.1:${server.httpServer.address().port}` };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Transparent observation of the real factory; no Sigma/worker/layout replacement. */
export async function observeProductRenderer(page) {
  await page.route(
    url => url.pathname.endsWith('/src/render/rendererFactory.ts') && !url.search,
    route =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `
      import realFactory from '/src/render/rendererFactory.ts?observed';
      export default function (...args) {
        const factory = realFactory(...args);
        return { createRenderer(type) {
          const renderer = factory.createRenderer(type);
          window.requirementsRenderer = renderer;
          return renderer;
        }};
      }`,
      })
  );
}

export async function nextFrames(page, count = 2) {
  await page.evaluate(
    count =>
      new Promise(resolve => {
        const frame = () => {
          if (--count <= 0) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    count
  );
}

export async function waitForView(page) {
  await nextFrames(page);
  await page.waitForFunction(() => {
    const renderer = window.requirementsRenderer ?? window.motionFixture?.renderer;
    const sigma = window.requirementsSigma ?? window.motionFixture?.sigma;
    return renderer && sigma && !renderer.isManipulating() && !sigma.getCamera().isAnimated();
  });
  await nextFrames(page);
}

export async function waitForMotionIdle(page) {
  await page.waitForFunction(
    () => {
      const renderer = window.requirementsRenderer ?? window.motionFixture?.renderer;
      return renderer && !renderer.isManipulating() && !renderer.getLayoutMotionState().running;
    },
    undefined,
    { timeout: 30000 }
  );
  await nextFrames(page);
}

/** An intentional observation window tests invariance throughout, rather than eventual success. */
export async function observeUnchanged(page, read, durationMs = 400) {
  const before = await page.evaluate(read);
  const deadline = performance.now() + durationMs;
  do {
    await nextFrames(page, 1);
    assert.deepEqual(await page.evaluate(read), before);
  } while (performance.now() < deadline);
}
