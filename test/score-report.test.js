'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const M = require('../dec41-progress-merge.js');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

(function testBuildMatchesCacheBust() {
  const build = (html.match(/<meta name="mrj-build" content="([^"]+)"/) || [])[1];
  const mergeV = (html.match(/dec41-progress-merge\.js\?v=([^"]+)/) || [])[1];
  const inlineBuild = (html.match(/const MRJ_BUILD='([^']+)'/) || [])[1];
  assert.ok(build, 'mrj-build meta');
  assert.strictEqual(build, mergeV, 'merge script ?v= must match mrj-build');
  assert.strictEqual(build, inlineBuild, 'MRJ_BUILD must match mrj-build');
})();

function extractFunctionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'missing function ' + name);
  let i = source.indexOf('{', start);
  assert.ok(i >= 0, 'missing { for ' + name);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unclosed function ' + name);
}

function extractMainInlineScript(source) {
  const open = source.indexOf("const MRJ_BUILD='");
  const close = source.indexOf('</script>', open);
  assert.ok(open >= 0 && close > open, 'main inline script');
  return source.slice(open, close);
}

function createReportingSandbox(mrjAuth, storage) {
  const noteScores = [];
  const posts = [];
  const main = extractMainInlineScript(html);
  const fnNames = [
    'localDate',
    'signedInForReport',
    'scoreItemId',
    'postClassroomMetricsBody',
    'reportScore',
    'speakPageSection',
    'speakAggregateScores'
  ];
  const fns = fnNames.map((n) => extractFunctionSource(main, n)).join('\n');

  const sandbox = {
    MERGE: M,
    window: { MRJ_AUTH: mrjAuth, DEC41_PROGRESS_MERGE: M },
    MRJ_AUTH: mrjAuth,
    SCORE_URL: 'https://test.example/score',
    localStorage: {
      getItem: (k) => (storage && storage[k] !== undefined ? storage[k] : null),
      setItem: () => {}
    },
    fetch: (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({ json: () => ({ ok: true }) });
    },
    noteScores,
    posts,
    bookProgStore: {},
    pack: null,
    Math,
    Date,
    JSON,
    String,
    isFinite,
    console
  };

  const script = [
    'function sheetPost(url, body) {',
    '  return fetch(url, { method: "POST", headers: {}, body: JSON.stringify(body) });',
    '}',
    'function saveSheetProgress() {}',
    'function studentName() {',
    '  try {',
    '    if (window.MRJ_AUTH && MRJ_AUTH.student()) return String(MRJ_AUTH.student()).trim();',
    '    return String(localStorage.getItem("mrj-dec-student") || "").trim();',
    '  } catch (e) { return ""; }',
    '}',
    'function studentIdKey() {',
    '  const name = studentName();',
    '  if (!name) return "";',
    '  return String(name).trim().toLowerCase().replace(/\\s+/g, " ");',
    '}',
    'function bookProg(id) {',
    '  return Object.assign({ speakPages: {} }, __bookProgStore[id] || {});',
    '}',
    'function setBookProg(id, patch) {',
    '  __bookProgStore[id] = Object.assign({}, bookProg(id), patch);',
    '}',
    fns,
    'api = {',
    '  reportScore: reportScore,',
    '  speakPageSection: speakPageSection,',
    '  speakAggregateScores: speakAggregateScores,',
    '  localDate: localDate',
    '};'
  ].join('\n');

  sandbox.__bookProgStore = sandbox.bookProgStore;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: 'score-report-sandbox.js' });
  return sandbox;
}

(function testDictationReportsCmAndSsi() {
  const mrj = {
    student: () => 'zz_test_mrjmetrics',
    noteScore: (o) => { mrj._notes = mrj._notes || []; mrj._notes.push(o); }
  };
  const sb = createReportingSandbox(mrj, {});
  const ld = sb.api.localDate();
  sb.api.reportScore('mlr_dec_045', 'dictation', 4, 5, { completed: true, metadata: { misses: 1 } });
  assert.strictEqual(sb.posts.length, 1);
  const ev = sb.posts[0].body.events[0];
  assert.strictEqual(ev.item_id, 'mlr_dec_045:dictation');
  assert.strictEqual(ev.score_value, 4);
  assert.strictEqual(ev.score_max, 5);
  assert.strictEqual(ev.score_pct, 80);
  assert.strictEqual(ev.local_date, ld);
  assert.strictEqual(sb.posts[0].body.student_email, 'zz_test_mrjmetrics');
  assert.strictEqual(sb.posts[0].body.session_id, 'decodable-zz_test_mrjmetrics-' + ld);
  assert.strictEqual(mrj._notes.length, 1);
  const note = JSON.parse(JSON.stringify(mrj._notes[0]));
  assert.deepStrictEqual(note, {
    program: 'decodable',
    itemId: 'mlr_dec_045:dictation',
    scoreValue: 4,
    scoreMax: 5,
    scorePct: 80,
    localDate: ld
  });
})();

(function testSpeakTenPagesNoteScoresAndAggregate() {
  const mrj = {
    student: () => 'zz_test_mrjmetrics',
    noteScore: (o) => { mrj._notes = mrj._notes || []; mrj._notes.push(o); }
  };
  const sb = createReportingSandbox(mrj, {});
  const book = 'mlr_dec_045';
  sb.pack = { book_id: book, pages: new Array(10) };
  for (let p = 0; p < 10; p++) {
    sb.api.reportScore(book, sb.api.speakPageSection(p), 70 + p, 100, { metadata: { page: p + 1 } });
    sb.bookProgStore[book] = Object.assign({}, sb.bookProgStore[book] || {}, {
      speakPages: Object.assign({}, (sb.bookProgStore[book] && sb.bookProgStore[book].speakPages) || {}, { [p]: 70 + p })
    });
  }
  const agg = sb.api.speakAggregateScores(book, 10);
  assert.strictEqual(agg.raw, 745);
  assert.strictEqual(agg.max, 1000);
  sb.api.reportScore(book, 'speak', agg.raw, agg.max, { metadata: { pages: 10 } });
  const pageNotes = mrj._notes.filter((n) => /:speak-p\d+$/.test(n.itemId));
  assert.strictEqual(pageNotes.length, 10);
  const speakNote = mrj._notes.find((n) => n.itemId === book + ':speak');
  assert.ok(speakNote);
  assert.strictEqual(speakNote.scoreMax, 1000);
})();

(function testSignedOutWithLegacyLocalNameSendsNothing() {
  const mrj = { student: () => '', noteScore: () => { throw new Error('noteScore'); } };
  const sb = createReportingSandbox(mrj, { 'mrj-dec-student': 'stale_name' });
  sb.api.reportScore('mlr_dec_045', 'listen', 1, 1, { itemType: 'completion' });
  assert.strictEqual(sb.posts.length, 0);
})();

console.log('score-report: ok');
