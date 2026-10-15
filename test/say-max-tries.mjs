#!/usr/bin/env node
'use strict';

/**
 * Say mode: every mic completion counts toward SAY_MAX_TRIES; Next unlocks at 5.
 * node test/say-max-tries.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SAY_MAX = 5;
const BOOK = 'mlr_dec_061';
const STUDENT = 'zz_test_say5';

const MRJ_AUTH_STUB = `
window.MRJ_AUTH = {
  student: function () { return window.__MRJ_TEST_STUDENT || ''; },
  token: function () { return 'playwright-test-token'; },
  signOut: function () { window.__MRJ_TEST_STUDENT = ''; },
  loadPack: function () { return Promise.resolve({ progress_json: '{}' }); },
  savePack: function () {},
  mount: function (_gate, opts) {
    var id = window.__MRJ_TEST_STUDENT;
    if (opts && opts.onReady) opts.onReady({ id: id, progress: [] });
  }
};
`;

const MRJ_BOOT_STUB = `
(function () {
  document.documentElement.classList.remove('mrj-auth-locked');
  var gate = document.getElementById('mrj-auth-gate');
  if (gate) gate.hidden = true;
  document.dispatchEvent(new CustomEvent('mrj-auth-ready', {
    bubbles: true,
    detail: { id: window.__MRJ_TEST_STUDENT, progress: [] }
  }));
})();
`;

const GRADE_STUB = `
window.__gradeCalls = 0;
window.MRJPronounce = {
  load: async function () { return true; },
  grade: async function (_blob, _line) {
    window.__gradeCalls += 1;
    const mode = window.__gradeMode || 'door';
    if (mode === 'error' && window.__gradeCalls === 2) throw new Error('synthetic grade_error');
    if (mode === 'stub' && window.__gradeCalls === 3) {
      return { meta: { scoring_mode: 'stub' }, overall: { score: 0 } };
    }
    const door = mode === 'door' || (mode === 'mixed' && window.__gradeCalls !== 4);
    if (door) {
      return {
        doorFail: true,
        reason: 'Say the sentence again, please. Say each word clearly.',
        overall: { score: 0, band: 'fail' },
        words: [],
        meta: { scoring_mode: 'hubert-phoneme' },
      };
    }
    return {
      doorFail: false,
      overall: { score: 0.12, band: 'fail' },
      words: [],
      meta: { scoring_mode: 'hubert-phoneme' },
    };
  },
};
`;

function startStaticServer() {
  const mime = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.onnx': 'application/octet-stream',
    '.wasm': 'application/wasm',
  };
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        const rel = urlPath === '/' ? '/index.html' : urlPath;
        const filePath = path.join(ROOT, rel.replace(/^\//, ''));
        if (!filePath.startsWith(ROOT)) {
          res.writeHead(403);
          res.end('forbidden');
          return;
        }
        const data = await readFile(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, {
          'Content-Type': mime[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/` });
    });
  });
}

async function makeContext(browser, gradeMode) {
  const context = await browser.newContext();
  await context.grantPermissions(['microphone']);
  await context.route('**/mrj-signin/mrj-auth.js', (route) => {
    route.fulfill({ status: 200, contentType: 'application/javascript', body: MRJ_AUTH_STUB });
  });
  await context.route('**/mrj-signin/mrj-auth-boot.js**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/javascript', body: MRJ_BOOT_STUB });
  });
  await context.route('**/mrj-signin/mrj-auth.css', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('**/pronounce/grade-browser.js**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: GRADE_STUB,
    });
  });
  const page = await context.newPage();
  await page.addInitScript((student, mode) => {
    window.__MRJ_TEST_STUDENT = student;
    window.__gradeMode = mode;
    localStorage.setItem('mrj-dec-student', student);
  }, STUDENT, gradeMode);
  return { context, page };
}

async function enterSpeakMode(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#libList .card', { timeout: 20000 });
  await page.evaluate((bookId) => {
    setBookProg(bookId, { listen: true, read: true, song: true, dictation: true });
  }, BOOK);
  await page.evaluate(async (bookId) => {
    introDone = true;
    await openBook(bookId);
    introDone = true;
    setMode('speak');
  }, BOOK);
  await page.waitForSelector('#sayLine', { timeout: 15000 });
}

async function micAttempts(page, n) {
  for (let i = 0; i < n; i++) {
    await page.click('#sayLine');
    await page.waitForTimeout(500);
    const stop = page.locator('#sayStop:not(.hidden)');
    if (await stop.count()) await stop.click();
    await page.waitForTimeout(600);
  }
}

async function runScenario(name, gradeMode) {
  const { server, baseUrl } = await startStaticServer();
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const { context, page } = await makeContext(browser, gradeMode);
  try {
    await enterSpeakMode(page, baseUrl);
    await micAttempts(page, SAY_MAX);
    const state = await page.evaluate(() => ({
      nextVisible: !!(document.getElementById('sayNext') && !document.getElementById('sayNext').classList.contains('hidden')),
      tries: typeof sayTries !== 'undefined' ? sayTries : -1,
      mic: typeof sayMicPresses !== 'undefined' ? sayMicPresses : -1,
      gradeCalls: window.__gradeCalls || 0,
    }));
    if (!state.nextVisible) throw new Error(`${name}: Next not visible (${JSON.stringify(state)})`);
    if (state.tries < SAY_MAX && state.mic < SAY_MAX) {
      throw new Error(`${name}: counters too low (${JSON.stringify(state)})`);
    }
    console.log(`OK ${name}:`, state);
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }
}

async function main() {
  await runScenario('doorFail-only', 'door');
  await runScenario('low-score', 'score');
  await runScenario('mixed-error-stub-door', 'mixed');
  console.log('say-max-tries: all scenarios passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
