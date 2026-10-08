/**
 * Decodable books 61–80 progress merge (shared by index.html and node tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DEC41_PROGRESS_MERGE = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function blankProg() {
    return {
      passed: false,
      listen: false,
      song: false,
      read: false,
      dictation: false,
      speak: false,
      readPages: {},
      difficulty: null,
      dictScore: null,
      speakPages: {}
    };
  }

  function mergeTruthyMaps(a, b) {
    var out = {};
    var keys = {};
    var ak = a && typeof a === 'object' ? Object.keys(a) : [];
    var bk = b && typeof b === 'object' ? Object.keys(b) : [];
    ak.forEach(function (k) { keys[k] = true; });
    bk.forEach(function (k) { keys[k] = true; });
    Object.keys(keys).forEach(function (k) {
      out[k] = !!(a && a[k]) || !!(b && b[k]);
    });
    return out;
  }

  function mergeSpeakPages(a, b) {
    var out = {};
    var keys = {};
    var ak = a && typeof a === 'object' ? Object.keys(a) : [];
    var bk = b && typeof b === 'object' ? Object.keys(b) : [];
    ak.forEach(function (k) { keys[k] = true; });
    bk.forEach(function (k) { keys[k] = true; });
    Object.keys(keys).forEach(function (k) {
      var la = a ? a[k] : null;
      var sb = b ? b[k] : null;
      if (la == null && sb == null) return;
      if (la == null) { out[k] = sb; return; }
      if (sb == null) { out[k] = la; return; }
      var na = +la;
      var nb = +sb;
      out[k] = isFinite(na) && isFinite(nb) ? Math.max(na, nb) : (isFinite(na) ? na : nb);
    });
    return out;
  }

  function mergeSpeakFails(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
      var set = {};
      (Array.isArray(a) ? a : []).forEach(function (x) { set[String(x)] = x; });
      (Array.isArray(b) ? b : []).forEach(function (x) { set[String(x)] = x; });
      return Object.keys(set).map(function (k) { return set[k]; });
    }
    var out = {};
    if (a && typeof a === 'object') {
      Object.keys(a).forEach(function (k) { out[k] = a[k]; });
    }
    if (b && typeof b === 'object') {
      Object.keys(b).forEach(function (k) {
        if (!out[k]) {
          out[k] = b[k];
          return;
        }
        if (Array.isArray(out[k]) && Array.isArray(b[k])) {
          var u = {};
          out[k].concat(b[k]).forEach(function (x) { u[String(x)] = x; });
          out[k] = Object.keys(u).map(function (kk) { return u[kk]; });
        }
      });
    }
    return out;
  }

  function mergeBookProgress(local, server) {
    local = local || {};
    server = server || {};
    var out = Object.assign(blankProg(), local);
    ['passed', 'listen', 'song', 'read', 'dictation', 'speak'].forEach(function (f) {
      out[f] = !!(local[f] || server[f]);
    });
    var scores = [local.dictScore, server.dictScore].filter(function (x) {
      return x != null && isFinite(+x);
    });
    if (scores.length) {
      out.dictScore = Math.max.apply(null, scores.map(Number));
    }
    var revs = [local.rev, server.rev].filter(function (x) {
      return x != null && isFinite(+x);
    });
    if (revs.length) {
      out.rev = Math.max.apply(null, revs.map(Number));
    }
    out.readPages = mergeTruthyMaps(local.readPages, server.readPages);
    out.reported = mergeTruthyMaps(local.reported, server.reported);
    out.speakPages = mergeSpeakPages(local.speakPages, server.speakPages);
    out.speakFails = mergeSpeakFails(local.speakFails, server.speakFails);
    out.difficulty = local.difficulty != null ? local.difficulty : server.difficulty;
    return out;
  }

  function mergeBooksMap(localBooks, serverBooks) {
    localBooks = localBooks && typeof localBooks === 'object' ? localBooks : {};
    serverBooks = serverBooks && typeof serverBooks === 'object' ? serverBooks : {};
    var out = {};
    var ids = {};
    Object.keys(localBooks).forEach(function (id) { ids[id] = true; });
    Object.keys(serverBooks).forEach(function (id) { ids[id] = true; });
    Object.keys(ids).forEach(function (id) {
      out[id] = mergeBookProgress(localBooks[id], serverBooks[id]);
    });
    return out;
  }

  function parsePackBooks(raw) {
    if (raw == null || raw === '') return { ok: true, books: {} };
    try {
      var data = JSON.parse(String(raw));
      if (!data || typeof data !== 'object' || !data.books || typeof data.books !== 'object') {
        return { ok: true, books: {} };
      }
      return { ok: true, books: data.books };
    } catch (e) {
      return { ok: true, books: {}, unparseable: true };
    }
  }

  function progressJsonRicherThan(localBooks, serverBooks) {
    var merged = mergeBooksMap(localBooks, serverBooks);
    return JSON.stringify({ v: 1, books: merged }) !== JSON.stringify({ v: 1, books: serverBooks || {} });
  }

  var SHARED_DEVICE_KEY = 'mrj_dec_progress_v4';

  function studentProgressKey(idKey) {
    idKey = String(idKey == null ? '' : idKey).trim();
    if (!idKey) return '';
    return SHARED_DEVICE_KEY + ':' + idKey;
  }

  /** Load only the per-student key; never read the shared legacy device key. */
  function loadStudentProgressStore(getItem, idKey) {
    var key = studentProgressKey(idKey);
    if (!key) return {};
    var raw = getItem(key);
    if (raw == null || raw === '') return {};
    try {
      var data = JSON.parse(String(raw));
      return data && typeof data === 'object' ? data : {};
    } catch (e) {
      return {};
    }
  }

  function progressUploadJson(store, studentDisplayName) {
    store = store && typeof store === 'object' ? store : {};
    var books = (store.byStudent && studentDisplayName && store.byStudent[studentDisplayName]) || {};
    return JSON.stringify({ v: 1, books: books });
  }

  /** Whether library UI may open (assets loaded + signed-in student). */
  function createLibraryBootCoordinator() {
    var assetsReady = false;
    var signedIn = false;
    var opened = false;
    return {
      markAssetsReady: function () {
        assetsReady = true;
        return this.consumeOpen();
      },
      onAuthReady: function (hasStudent) {
        signedIn = !!hasStudent;
        if (!signedIn) {
          opened = false;
          return false;
        }
        return this.consumeOpen();
      },
      onSignOut: function () {
        signedIn = false;
        opened = false;
        return false;
      },
      consumeOpen: function () {
        if (!signedIn || !assetsReady || opened) return false;
        opened = true;
        return true;
      },
      shouldShowLibrary: function () {
        return signedIn && assetsReady;
      }
    };
  }

  /** Metrics item_id for decodable section scores (books 61–80 band). */
  function decodableScoreItemId(bookId, section) {
    bookId = String(bookId == null ? '' : bookId).trim();
    section = String(section == null ? '' : section).trim();
    if (!bookId || !section) return section || bookId || '';
    var prefix = bookId + ':';
    if (section.indexOf(prefix) === 0) return section;
    return prefix + section;
  }

  /** Save gating helper for tests */
  function createPackSaveGate() {
    var state = 'idle';
    var saveQueued = false;
    return {
      state: function () { return state; },
      beginLoad: function () { state = 'loading'; },
      finishLoadOk: function () { state = 'loaded'; saveQueued = false; },
      finishLoadFail: function () { state = 'failed'; },
      requestSave: function () {
        if (state !== 'loaded') {
          saveQueued = true;
          return { sent: false, queued: true };
        }
        return { sent: true, queued: false };
      },
      flushQueued: function () {
        if (state === 'loaded' && saveQueued) {
          saveQueued = false;
          return true;
        }
        return false;
      },
      maySave: function () { return state === 'loaded'; }
    };
  }

  return {
    SHARED_DEVICE_KEY: SHARED_DEVICE_KEY,
    blankProg: blankProg,
    mergeBookProgress: mergeBookProgress,
    mergeBooksMap: mergeBooksMap,
    parsePackBooks: parsePackBooks,
    progressJsonRicherThan: progressJsonRicherThan,
    studentProgressKey: studentProgressKey,
    loadStudentProgressStore: loadStudentProgressStore,
    progressUploadJson: progressUploadJson,
    createPackSaveGate: createPackSaveGate,
    createLibraryBootCoordinator: createLibraryBootCoordinator,
    decodableScoreItemId: decodableScoreItemId
  };
});
