import { createRequire } from 'node:module';

// Browser smoke tests share the evaluation project's declared Playwright dependency.
const require = createRequire(new URL('../../../../eval/browser/package.json', import.meta.url));
export const { chromium } = require('@playwright/test');
