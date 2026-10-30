#!/usr/bin/env node
'use strict';

/**
 * Letter-intro step in a real browser (books 61–80):
 *   node test/letter-intro-flow.mjs
 * Needs ffmpeg: Playwright's Chromium cannot decode H.264, so assets/decodable/letter_intro/*.mp4 is
 * answered with a throwaway 1.5 s WebM made in a temp dir (or a 404 for the missing-file case).
 * LETTER_INTRO_SHOTS=<dir> also saves screenshots.
 */
import assert from 'node:assert';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const STUDENT = 'zz_test_letter_intro';
const SHOTS = process.env.LETTER_INTRO_SHOTS || '';

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

const PRONOUNCE_STUB = `window.MRJPronounce = { setBase: function () {}, load: function () { return Promise.resolve(true); } };`;

// Playwright evaluates with a user gesture, so a real autoplay block cannot happen here. This mimics the
// browser rule instead: unmuted play() rejects with NotAllowedError until the first trusted tap.
const SOUND_NEEDS_TAP = `
(function () {
  var blocked = true;
  var realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (blocked && !this.muted) return Promise.reject(new DOMException('play() needs a user gesture', 'NotAllowedError'));
    return realPlay.call(this);
  };
  document.addEventListener('pointerdown', function (e) { if (e.isTrusted) blocked = false; }, true);
})();
`;

function makeClip(dir) {
  const out = path.join(dir, 'letter_intro_test.webm');
  try {
    execFileSync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000',
      '-t', '1.5', '-c:v', 'libvpx', '-b:v', '400k', '-c:a', 'libopus', '-shortest', out
    ]);
  } catch (e) {
    throw new Error('letter-intro-flow needs ffmpeg (with libvpx + libopus) to make a test clip: ' + e.message);
  }
  return readFile(out);
}

function startStaticServer() {
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css',
    '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.png': 'image/png' };
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        const rel = urlPath === '/' ? '/index.html' : urlPath;
        const filePath = path.join(ROOT, rel.replace(/^\//, ''));
        if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
        const data = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}/` }));
  });
}

async function makePage(browser, baseUrl, clip, state) {
  const context = await browser.newContext({ viewport: state.viewport || { width: 1280, height: 800 } });
  await context.route('**/mrj-signin/mrj-auth.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MRJ_AUTH_STUB }));
  await context.route('**/mrj-signin/mrj-auth-boot.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MRJ_BOOT_STUB }));
  await context.route('**/mrj-signin/mrj-auth.css', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('**/pronounce/grade-browser.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: PRONOUNCE_STUB }));
  await context.route('https://script.google.com/**', (r) => {
    try { state.posts.push(JSON.parse(r.request().postData() || '{}')); } catch { /* ignore */ }
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await context.route('**/assets/decodable/letter_intro/**', (r) => {
    state.clipRequests.push(r.request().url());
    if (state.missing) r.fulfill({ status: 404, body: 'not found' });
    else r.fulfill({ status: 200, contentType: 'video/webm', body: clip });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => state.errors.push(String(e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'warning') state.warnings.push(m.text()); });
  if (state.initScript) await page.addInitScript(state.initScript);
  await page.addInitScript((student) => {
    window.__MRJ_TEST_STUDENT = student;
    localStorage.setItem('mrj-dec-student', student);
  }, STUDENT);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#libList .card', { timeout: 20000 });
  return { context, page };
}

const newState = (extra) => Object.assign({ posts: [], clipRequests: [], errors: [], warnings: [], missing: false }, extra);
const itemIds = (state) => state.posts.map((b) => (b.events && b.events[0] && b.events[0].item_id) || '');
const waitStep = (page, step) => page.waitForFunction((s) => introStep === s && mode === 'intro', step, { timeout: 15000 });
const nextEnabled = (page) => page.waitForFunction(() => !document.getElementById('introGo').disabled, null, { timeout: 15000 });
const isNextDisabled = (page) => page.$eval('#introGo', (b) => b.disabled);

async function shot(page, name) {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function letterIntroState(page) {
  return page.evaluate(() => {
    const plain = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const v = document.getElementById('letterIntroVid');
    const st = document.getElementById('introStage');
    return {
      bleed: st.classList.contains('li-bleed'),
      padding: getComputedStyle(st).padding,
      src: v ? v.currentSrc || v.src : '',
      muted: v ? v.muted : null,
      stage: plain(st), video: v ? plain(v) : null, next: plain(document.getElementById('introGo')),
      tapVisible: !document.getElementById('liTap').classList.contains('hidden'),
      msg: document.getElementById('liMsg').textContent,
      badge: document.getElementById('modeBadge').textContent
    };
  });
}

function assertFullBleed(s, label) {
  assert.ok(s.bleed, label + ': li-bleed on #introStage');
  assert.strictEqual(s.padding, '0px', label + ': no stage padding');
  const near = (a, b) => Math.abs(a - b) <= 1;
  assert.ok(near(s.video.l, s.stage.l) && near(s.video.r, s.stage.r) && near(s.video.t, s.stage.t),
    label + ': video spans the stage edge to edge ' + JSON.stringify(s));
  assert.ok(near(s.video.b, s.next.t) && near(s.next.b, s.stage.b), label + ': Next bar sits under the video');
}

async function bypassFamousGate(page) {
  // The famous-word clips are H.264, which Playwright's Chromium cannot play.
  await page.evaluate(() => { famousVidEnded = true; famousAudEnded = true; syncFamousGate(); });
}

async function scenarioSoundCardBook(browser, baseUrl, clip) {
  const state = newState();
  const { context, page } = await makePage(browser, baseUrl, clip, state);
  try {
    await page.click('.card[data-id="mlr_dec_061"]');
    await waitStep(page, 'cousin');
    assert.match(await page.textContent('#introBody'), /AI \/ AY/, 'sound card first');
    await page.click('#introGo');
    await waitStep(page, 'letter-intro');
    let s = await letterIntroState(page);
    assert.match(s.src, /\/assets\/decodable\/letter_intro\/ai_ay_letter_intro\.mp4\?v=/, 'asset() path for book 61');
    assert.strictEqual(s.muted, false, 'letter intro plays with sound');
    assert.match(s.badge, /^Letter intro/);
    assertFullBleed(s, '061');
    await page.waitForFunction(() => { const v = document.getElementById('letterIntroVid'); return v.currentTime > 0.2 && !v.ended; });
    assert.ok(await isNextDisabled(page), 'Next locked while the video plays');
    await page.click('#liScene');
    assert.ok(await isNextDisabled(page), 'tapping the video does not skip it');
    await shot(page, 'letter-intro-061-desktop-playing');
    await nextEnabled(page);
    assert.ok(await page.$eval('#letterIntroVid', (v) => v.ended), 'Next unlocks when the video ends');
    assert.deepStrictEqual(itemIds(state).filter((i) => /letter-intro/.test(i)), ['mlr_dec_061:letter-intro']);
    assert.strictEqual(await page.evaluate(() => bookProg('mlr_dec_061')['letter-intro']), true);
    await shot(page, 'letter-intro-061-desktop-ended');

    await page.click('#introGo');
    await waitStep(page, 'famous-card');
    assert.match(await page.textContent('#introBody'), /sleep/, 'then the famous word card');
    s = await page.evaluate(() => ({ bleed: document.getElementById('introStage').classList.contains('li-bleed'), vid: !!document.getElementById('letterIntroVid') }));
    assert.deepStrictEqual(s, { bleed: false, vid: false }, 'letter-intro layout and video are gone');

    await page.evaluate(() => testBackIntro());
    await waitStep(page, 'letter-intro');
    assert.strictEqual(await isNextDisabled(page), false, 'already watched: Next stays open when coming back');
    await page.waitForFunction(() => document.getElementById('letterIntroVid').ended, null, { timeout: 15000 });
    await page.click('#liScene');
    await page.waitForFunction(() => { const v = document.getElementById('letterIntroVid'); return !v.ended && !v.paused; });
    await page.waitForFunction(() => document.getElementById('letterIntroVid').ended, null, { timeout: 15000 });
    assert.strictEqual(itemIds(state).filter((i) => /letter-intro/.test(i)).length, 1, 'replays never report twice');
    await page.evaluate(() => testBackIntro());
    await waitStep(page, 'cousin');
    assert.match(await page.textContent('#introBody'), /AI \/ AY/, 'back from letter-intro → sound card');
    await page.click('#introGo');
    await waitStep(page, 'letter-intro');
    await nextEnabled(page);
    await page.click('#introGo');
    await waitStep(page, 'famous-card');
    await page.click('#introGo');
    await waitStep(page, 'famous');
    await bypassFamousGate(page);
    await page.click('#introGo');
    await waitStep(page, 'chase');
    await page.evaluate(() => { preVideoDone = true; });
    await page.click('#introGo');
    await page.waitForFunction(() => mode === 'listen' && introDone && !document.getElementById('bookStage').classList.contains('hidden'));
    assert.deepStrictEqual(state.errors, []);
    console.log('OK 061 sound card → letter-intro → famous-card → famous → chase → listen; back-nav ok');
  } finally {
    await context.close();
  }
}

async function scenarioNoSoundCardBook(browser, baseUrl, clip) {
  const state = newState({ viewport: { width: 390, height: 844 } });
  const { context, page } = await makePage(browser, baseUrl, clip, state);
  try {
    await page.click('.card[data-id="mlr_dec_071"]');
    await waitStep(page, 'letter-intro');
    const s = await letterIntroState(page);
    assert.match(s.src, /\/assets\/decodable\/letter_intro\/schwa_a_letter_intro\.mp4\?v=/, 'book 71 opens straight into its video');
    assertFullBleed(s, '071 phone');
    assert.ok(itemIds(state).includes('mlr_dec_071:sound'), 'empty NEW_LETTERS still reports the sound step');
    assert.ok(await isNextDisabled(page));
    await page.waitForFunction(() => document.getElementById('letterIntroVid').currentTime > 0.2);
    await shot(page, 'letter-intro-071-phone-playing');
    await nextEnabled(page);
    assert.ok(itemIds(state).includes('mlr_dec_071:letter-intro'));
    await page.evaluate(() => testBackIntro());
    await page.waitForFunction(() => mode === 'library');
    await page.click('.card[data-id="mlr_dec_071"]');
    await waitStep(page, 'letter-intro');
    await nextEnabled(page);
    await page.click('#introGo');
    await waitStep(page, 'famous-card');
    assert.match(await page.textContent('#introBody'), /blue/);
    await page.click('#introGo');
    await waitStep(page, 'famous');
    await bypassFamousGate(page);
    await page.click('#introGo');
    await page.waitForFunction(() => mode === 'listen' && introDone, null, { timeout: 15000 });
    assert.deepStrictEqual(state.errors, []);
    console.log('OK 071 (no sound card) letter-intro → famous-card → famous → listen; back-nav → library');
  } finally {
    await context.close();
  }
}

async function scenarioMissingVideo(browser, baseUrl, clip) {
  const state = newState({ missing: true });
  const { context, page } = await makePage(browser, baseUrl, clip, state);
  try {
    await page.click('.card[data-id="mlr_dec_065"]');
    await waitStep(page, 'cousin');
    await page.click('#introGo');
    await waitStep(page, 'letter-intro');
    await nextEnabled(page);
    const s = await letterIntroState(page);
    assert.strictEqual(s.msg, 'The letter video is not ready yet. Tap Next.');
    assert.strictEqual(s.tapVisible, false);
    assert.ok(state.warnings.some((w) => /letter-intro video missing/.test(w) && /oa_letter_intro\.mp4/.test(w)));
    assert.ok(!itemIds(state).some((i) => /letter-intro/.test(i)), 'a missing video is not reported as watched');
    await shot(page, 'letter-intro-065-missing-file');
    await page.click('#introGo');
    await waitStep(page, 'famous-card');
    assert.match(await page.textContent('#introBody'), /moon/);
    assert.deepStrictEqual(state.errors, []);
    console.log('OK 065 missing mp4 → message, Next unlocked, no report → famous-card');
  } finally {
    await context.close();
  }
}

async function scenarioMergedProgress(browser, baseUrl, clip) {
  const state = newState();
  const { context, page } = await makePage(browser, baseUrl, clip, state);
  try {
    await page.evaluate(() => {
      const all = loadAll();
      all.byStudent = all.byStudent || {};
      all.byStudent[studentName()] = MERGE.mergeBooksMap({}, { mlr_dec_062: { listen: true, reported: ['sound'] } });
      saveAll(all);
    });
    assert.strictEqual(await page.evaluate(() => Array.isArray(bookProg('mlr_dec_062').reported)), false, 'merged shape is an object');
    await page.click('.card[data-id="mlr_dec_062"]');
    await waitStep(page, 'cousin');
    await page.click('#introGo');
    await waitStep(page, 'letter-intro');
    await nextEnabled(page);
    assert.ok(itemIds(state).includes('mlr_dec_062:letter-intro'), 'reports after a pack merge');
    assert.deepStrictEqual(state.errors, []);
    console.log('OK 062 merged progress (reported as object) → letter-intro reports without errors');
  } finally {
    await context.close();
  }
}

async function scenarioLeaveMidVideo(browser, baseUrl, clip) {
  const state = newState();
  const { context, page } = await makePage(browser, baseUrl, clip, state);
  try {
    await page.click('.card[data-id="mlr_dec_063"]');
    await waitStep(page, 'cousin');
    await page.click('#introGo');
    await waitStep(page, 'letter-intro');
    await page.waitForFunction(() => document.getElementById('letterIntroVid').currentTime > 0.2);
    await page.click('#btnLibrary');
    await page.waitForFunction(() => mode === 'library');
    const s = await page.evaluate(() => ({
      paused: document.getElementById('letterIntroVid').paused,
      bleed: document.getElementById('introStage').classList.contains('li-bleed')
    }));
    assert.deepStrictEqual(s, { paused: true, bleed: false }, 'Books stops the letter video');
    await page.waitForTimeout(1800);
    assert.ok(!itemIds(state).includes('mlr_dec_063:letter-intro'), 'leaving early is not a completion');
    assert.deepStrictEqual(state.errors, []);
    console.log('OK 063 Books mid-video pauses it and does not report');
  } finally {
    await context.close();
  }
}

async function scenarioAutoplayBlocked(browser, baseUrl, clip) {
  const state = newState({ initScript: SOUND_NEEDS_TAP });
  const { context, page } = await makePage(browser, baseUrl, clip, state);
  try {
    await page.evaluate(() => openBook('mlr_dec_072'));
    await waitStep(page, 'letter-intro');
    await page.waitForFunction(() => !document.getElementById('liTap').classList.contains('hidden'), null, { timeout: 10000 });
    assert.ok(await isNextDisabled(page));
    assert.strictEqual(await page.$eval('#letterIntroVid', (v) => v.paused), true);
    await shot(page, 'letter-intro-072-tap-to-play');
    await page.click('#liTap');
    await page.waitForFunction(() => document.getElementById('liTap').classList.contains('hidden'));
    await nextEnabled(page);
    assert.ok(itemIds(state).includes('mlr_dec_072:letter-intro'));
    assert.deepStrictEqual(state.errors, []);
    console.log('OK 072 autoplay blocked → ▶ tap → plays → Next');
  } finally {
    await context.close();
  }
}

async function main() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'letter-intro-'));
  const { server, baseUrl } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const clip = await makeClip(tmp);
    await scenarioSoundCardBook(browser, baseUrl, clip);
    await scenarioNoSoundCardBook(browser, baseUrl, clip);
    await scenarioMissingVideo(browser, baseUrl, clip);
    await scenarioMergedProgress(browser, baseUrl, clip);
    await scenarioLeaveMidVideo(browser, baseUrl, clip);
    await scenarioAutoplayBlocked(browser, baseUrl, clip);
    console.log('letter-intro-flow: all scenarios passed');
  } finally {
    await browser.close();
    server.close();
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
