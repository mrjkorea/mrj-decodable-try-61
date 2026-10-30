'use strict';
// Letter-intro videos for books 61–80: manifest = align letter_intros = LETTER_INTRO fallback,
// intro order cousin → letter-intro → famous-card, and once-only reportIntroStep('letter-intro').
// LETTER_INTRO_REQUIRE_MP4=1 also requires all 20 real mp4s in assets/decodable/letter_intro/.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const M = require('../dec41-progress-merge.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const DIR = path.join(root, 'assets', 'decodable', 'letter_intro');
const REQUIRE_MP4 = process.env.LETTER_INTRO_REQUIRE_MP4 === '1';

// try-61_list.json (same names as book_to_intros.json for 61–80)
const EXPECTED = {
  61: 'ai_ay_letter_intro.mp4',
  62: 'ee_letter_intro.mp4',
  63: 'ea_ee_letter_intro.mp4',
  64: 'igh_letter_intro.mp4',
  65: 'oa_letter_intro.mp4',
  66: 'oo_long_letter_intro.mp4',
  67: 'oo_short_letter_intro.mp4',
  68: 'ou_ow_letter_intro.mp4',
  69: 'oi_oy_letter_intro.mp4',
  70: 'au_aw_letter_intro.mp4',
  71: 'schwa_a_letter_intro.mp4',
  72: 'ey_letter_intro.mp4',
  73: 'ea_short_letter_intro.mp4',
  74: 'ow_long_letter_intro.mp4',
  75: 'ew_ue_letter_intro.mp4',
  76: 'air_letter_intro.mp4',
  77: 'ear_letter_intro.mp4',
  78: 'kn_letter_intro.mp4',
  79: 'wr_letter_intro.mp4',
  80: 'mb_letter_intro.mp4'
};
const bookId = (n) => 'mlr_dec_' + String(n).padStart(3, '0');
const BOOKS = Object.keys(EXPECTED).map(Number);

function extractFunctionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'missing function ' + name);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed function ' + name);
}
function extractConst(source, re, label) {
  const m = source.match(re);
  assert.ok(m, 'missing ' + label);
  return m[0];
}
const LETTER_INTRO_SRC = extractConst(html, /const LETTER_INTRO=\{[\s\S]*?\};/, 'LETTER_INTRO');
const LETTER_INTRO_DIR_SRC = extractConst(html, /const LETTER_INTRO_DIR='[^']*';/, 'LETTER_INTRO_DIR');
const SOUND_CARD_SRC = extractConst(html, /const SOUND_CARD=\{[\s\S]*?\n\};/, 'SOUND_CARD');

function sandbox(extra, fnNames, tail) {
  const ctx = Object.assign({ console }, extra);
  vm.createContext(ctx);
  const src = [LETTER_INTRO_DIR_SRC, LETTER_INTRO_SRC, SOUND_CARD_SRC]
    .map((s) => s.replace(/^const /, 'var '))
    .concat(fnNames.map((n) => extractFunctionSource(html, n)), tail || '')
    .join('\n');
  vm.runInContext(src, ctx, { filename: 'letter-intro-sandbox.js' });
  return ctx;
}

(function testFallbackMapMatchesManifest() {
  const ctx = sandbox({}, []);
  assert.strictEqual(ctx.LETTER_INTRO_DIR, 'decodable/letter_intro/');
  const want = {};
  BOOKS.forEach((n) => { want[bookId(n)] = [EXPECTED[n]]; });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.LETTER_INTRO)), want, 'LETTER_INTRO must be exactly books 061–080');
})();

(function testAlignLetterIntrosMatchManifest() {
  BOOKS.forEach((n) => {
    const align = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'align_' + bookId(n) + '.json'), 'utf8'));
    assert.strictEqual(align.book_id, bookId(n));
    assert.deepStrictEqual(align.letter_intros, [EXPECTED[n]], 'align letter_intros for ' + bookId(n));
  });
})();

(function testClipPathsFromAlignOrFallback() {
  const ctx = sandbox({ pack: null }, ['letterIntroClips']);
  assert.deepStrictEqual([...ctx.letterIntroClips()], [], 'no pack, no clips');
  ctx.pack = { book_id: 'mlr_dec_071' };
  assert.deepStrictEqual([...ctx.letterIntroClips()], ['decodable/letter_intro/schwa_a_letter_intro.mp4'], 'fallback map');
  ctx.pack = { book_id: 'mlr_dec_071', letter_intros: [] };
  assert.deepStrictEqual([...ctx.letterIntroClips()], ['decodable/letter_intro/schwa_a_letter_intro.mp4'], 'empty list falls back');
  ctx.pack = { book_id: 'mlr_dec_061', letter_intros: ['ai_ay_letter_intro.mp4', 'decodable/letter_intro/extra.mp4'] };
  assert.deepStrictEqual([...ctx.letterIntroClips()], [
    'decodable/letter_intro/ai_ay_letter_intro.mp4',
    'decodable/letter_intro/extra.mp4'
  ], 'align names win; paths kept as given');
  ctx.pack = { book_id: 'mlr_dec_081' };
  assert.deepStrictEqual([...ctx.letterIntroClips()], [], 'books outside 61–80 have no fallback');
})();

(function testReadmeListsEveryFile() {
  const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
  BOOKS.forEach((n) => {
    assert.ok(readme.includes(bookId(n)) && readme.includes('`' + EXPECTED[n] + '`'), 'README row for ' + bookId(n));
  });
})();

function topLevelBoxes(buf) {
  const boxes = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (size === 1 && off + 16 <= buf.length) size = Number(buf.readBigUInt64BE(off + 8));
    else if (size === 0) size = buf.length - off;
    if (size < 8) break;
    boxes.push({ type, start: off, end: Math.min(buf.length, off + size) });
    off += size;
  }
  return boxes;
}

(function testFolderHoldsOnlyRealExpectedMp4s() {
  const want = new Set(Object.values(EXPECTED));
  const files = fs.readdirSync(DIR).filter((f) => f !== 'README.md');
  files.forEach((f) => assert.ok(want.has(f), 'unexpected file in letter_intro/: ' + f));
  const missing = [...want].filter((f) => !files.includes(f));
  files.forEach((f) => {
    const buf = fs.readFileSync(path.join(DIR, f));
    const boxes = topLevelBoxes(buf);
    assert.ok(boxes.length && boxes[0].type === 'ftyp', f + ' is not an MP4 (no ftyp box)');
    const moov = boxes.find((b) => b.type === 'moov');
    const mdat = boxes.find((b) => b.type === 'mdat');
    assert.ok(moov && mdat, f + ' needs moov + mdat boxes');
    const meta = buf.toString('latin1', moov.start, moov.end);
    if (REQUIRE_MP4) assert.ok(/avc[13]/.test(meta), f + ' must be H.264 (avc1) so Safari and Chrome both play it');
    if (moov.start > mdat.start) console.warn('letter-intro: ' + f + ' is not faststart (moov after mdat)');
  });
  if (REQUIRE_MP4) assert.deepStrictEqual(missing, [], 'missing letter-intro mp4s');
  else if (missing.length) console.log('letter-intro: ' + missing.length + '/20 mp4s not in assets/decodable/letter_intro/ yet (app falls back)');
})();

function flowSandbox(book) {
  const calls = [];
  const ctx = sandbox({
    calls,
    $: () => null,
    pack: { book_id: book, famous: ['sleep'], law_breaker: book <= 'mlr_dec_070' ? ['talk'] : [] },
    NEW_LETTERS: {}
  }, ['letterIntroClips', 'cousinLetters', 'introAdvance', 'testBackIntro'], `
    var introStep = 'cousin', cousinIdx = 0, letterIntroDone = false, introDone = false, preVideoDone = false;
    var famousVidEnded = false, famousAudEnded = false;
    function showIntro() { calls.push('show:' + introStep); }
    function showLib() { calls.push('lib'); }
    function setMode(m) { calls.push('mode:' + m); }
    function syncLetterIntroGate() { calls.push('gate'); }
    function syncFamousGate() {}
    function stopFamousMedia() {}
  `);
  return ctx;
}

(function testIntroOrderForwardAndBack() {
  ['mlr_dec_061', 'mlr_dec_071'].forEach((book) => {
    const ctx = flowSandbox(book);
    ctx.introAdvance();
    assert.strictEqual(ctx.introStep, 'letter-intro', book + ': cousin → letter-intro');
    ctx.introAdvance();
    assert.strictEqual(ctx.introStep, 'letter-intro', book + ': Next is locked until the video ends');
    assert.strictEqual(ctx.calls[ctx.calls.length - 1], 'gate');
    ctx.letterIntroDone = true;
    ctx.introAdvance();
    assert.strictEqual(ctx.introStep, 'famous-card', book + ': letter-intro → famous-card');
    ctx.introAdvance();
    assert.strictEqual(ctx.introStep, 'famous', book + ': famous-card → famous');

    ctx.introStep = 'famous-card';
    ctx.testBackIntro();
    assert.strictEqual(ctx.introStep, 'letter-intro', book + ': back from famous-card → letter-intro');
    ctx.calls.length = 0;
    ctx.testBackIntro();
    if (book === 'mlr_dec_061') {
      assert.strictEqual(ctx.introStep, 'cousin', '061: back from letter-intro → sound card');
      assert.strictEqual(ctx.cousinIdx, 0);
    } else {
      assert.deepStrictEqual([...ctx.calls], ['lib'], '071 has no sound card: back from letter-intro → library');
    }
  });
})();

(function testEmptyLettersStillGetLetterIntro() {
  const show = extractFunctionSource(html, 'showIntro');
  assert.ok(/if\(!letters\.length\)\{ reportIntroStep\('sound'\); introStep='letter-intro'; showIntro\(\); return; \}/.test(show),
    'empty NEW_LETTERS must go to letter-intro, not famous-card');
  const li = show.indexOf("introStep==='letter-intro'");
  const fc = show.indexOf("introStep==='famous-card'");
  assert.ok(li > 0 && li < fc, 'letter-intro renders before famous-card');
  assert.ok(/<video class="liVid" id="letterIntroVid"[^>]*playsinline/.test(show), 'inline video');
  assert.ok(!/<video class="liVid"[^>]*\smuted/.test(show), 'letter-intro keeps its sound');
  assert.ok(/function hideAll\(\)\{ stopLetterIntro\(\);/.test(html), 'leaving the step stops the video');
})();

function reportSandbox(prog) {
  const store = { mlr_dec_061: prog };
  const reports = [];
  const ctx = sandbox({ store, reports, pack: { book_id: 'mlr_dec_061', sound: 'ai / ay' } }, ['reportedMap', 'reportIntroStep'], `
    function bookProg(id) { return Object.assign({}, store[id] || {}); }
    function setBookProg(id, patch) { store[id] = Object.assign({}, store[id] || {}, patch); }
    function soundLine() { return 'ai / ay'; }
    function reportScore(book, section, raw, max, extra) { reports.push({ book, section, raw, max, extra }); }
  `);
  return ctx;
}

(function testReportLetterIntroOnce() {
  const ctx = reportSandbox(undefined);
  ctx.reportIntroStep('letter-intro', { video: 'ai_ay_letter_intro.mp4' });
  ctx.reportIntroStep('letter-intro', { video: 'ai_ay_letter_intro.mp4' });
  assert.strictEqual(ctx.reports.length, 1, 'reported once');
  const r = ctx.reports[0];
  assert.strictEqual(r.section, 'letter-intro');
  assert.strictEqual(r.raw, 1);
  assert.strictEqual(r.max, 1);
  assert.strictEqual(r.extra.itemType, 'completion');
  assert.strictEqual(r.extra.metadata.video, 'ai_ay_letter_intro.mp4');
  assert.strictEqual(r.extra.metadata.sound, 'ai / ay');
  assert.strictEqual(ctx.store.mlr_dec_061['letter-intro'], true);
  assert.strictEqual(M.decodableScoreItemId('mlr_dec_061', 'letter-intro'), 'mlr_dec_061:letter-intro');
})();

(function testReportSurvivesMergedAndLegacyShapes() {
  const merged = reportSandbox(M.mergeBookProgress({ listen: true }, {}));
  assert.deepStrictEqual(merged.store.mlr_dec_061.reported, {}, 'pack merge leaves reported as an object');
  merged.reportIntroStep('letter-intro');
  assert.strictEqual(merged.reports.length, 1, 'object-shaped reported must not throw');

  const legacy = reportSandbox({ sound: true, reported: ['sound'] });
  legacy.reportIntroStep('letter-intro');
  assert.strictEqual(legacy.reports.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(legacy.store.mlr_dec_061.reported)), { sound: true, 'letter-intro': true });

  const server = legacy.store.mlr_dec_061;
  const otherDevice = reportSandbox(M.mergeBookProgress({}, server));
  otherDevice.reportIntroStep('letter-intro');
  assert.strictEqual(otherDevice.reports.length, 0, 'already reported on another device');
})();

console.log('letter-intro: ok');
