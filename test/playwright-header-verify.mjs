'use strict';

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TEST_STUDENT = 'zz_test_mrjmetrics';
const WIDTHS = [360, 390, 414, 1280];

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

function startStaticServer() {
  const mime = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4'
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
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
        res.end(data);
      } catch (e) {
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

async function measureHeader(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const header = document.querySelector('header');
    const pill = document.querySelector('[data-mrj-name-pill]');
    const lang = document.getElementById('langPick');
    const books = document.getElementById('btnLibrary');
    const switchBtn = document.getElementById('btnSwitch');
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) };
    };
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      noHScroll: doc.scrollWidth <= doc.clientWidth + 1,
      title: document.title,
      modeBadge: document.getElementById('modeBadge')?.textContent || '',
      libVisible: !document.getElementById('libStage')?.classList.contains('hidden'),
      bookCount: document.querySelectorAll('#libList .card').length,
      firstBookId: document.querySelector('#libList .card')?.dataset?.id || '',
      lastBookId: document.querySelector('#libList .card:last-child')?.dataset?.id || '',
      bandPrev: document.getElementById('bandLink')?.textContent || '',
      bandNext: document.getElementById('nextBand')?.textContent || '',
      header: rect(header),
      pill: rect(pill),
      lang: rect(lang),
      books: rect(books),
      switch: rect(switchBtn)
    };
  });
}

async function main() {
  const { server, baseUrl } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route('**/mrj-signin/mrj-auth.js', (route) => {
    route.fulfill({ status: 200, contentType: 'application/javascript', body: MRJ_AUTH_STUB });
  });
  await context.route('**/mrj-signin/mrj-auth-boot.js**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/javascript', body: MRJ_BOOT_STUB });
  });
  await context.route('**/mrj-signin/mrj-auth.css', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('**/mrj-decodable-try/pronounce/**', (route) => route.fulfill({ status: 200, body: '' }));

  const page = await context.newPage();
  await page.addInitScript((student) => {
    window.__MRJ_TEST_STUDENT = student;
    localStorage.setItem('mrj-dec-student', student);
  }, TEST_STUDENT);

  const table = [];
  let reloadOk = false;

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#libList .card', { timeout: 15000 });
    const m = await measureHeader(page);
    table.push({ width, ...m });
    if (!m.noHScroll) throw new Error('horizontal scroll at width ' + width);
    if (!m.libVisible) throw new Error('library hidden at width ' + width);
    if (m.title.indexOf('61-80') < 0) throw new Error('bad title: ' + m.title);
    if (m.modeBadge.indexOf('61-80') < 0) throw new Error('bad badge: ' + m.modeBadge);
    if (m.bookCount !== 20) throw new Error('expected 20 books, got ' + m.bookCount);
    if (m.firstBookId !== 'mlr_dec_061') throw new Error('first book ' + m.firstBookId);
    if (m.lastBookId !== 'mlr_dec_080') throw new Error('last book ' + m.lastBookId);
    if (m.bandPrev !== 'Books 41-60') throw new Error('prev band label ' + m.bandPrev);
    if (m.bandNext !== 'Books 81-100') throw new Error('next band label ' + m.bandNext);
    const vw = m.viewport.w;
    for (const [name, r] of Object.entries({ pill: m.pill, lang: m.lang, books: m.books, switch: m.switch })) {
      if (!r || r.right > vw + 1) throw new Error(name + ' overflows viewport at ' + width + ': right=' + (r && r.right));
    }
  }

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#libList .card', { timeout: 15000 });
  reloadOk = await page.evaluate(() => !document.getElementById('libStage').classList.contains('hidden'));

  await browser.close();
  server.close();

  console.log('playwright-header-verify: ok');
  console.log('reload_library_visible:', reloadOk);
  console.log('header_positions:', JSON.stringify(table, null, 2));
  if (!reloadOk) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
