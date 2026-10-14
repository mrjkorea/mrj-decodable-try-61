/* MRJ Pronounce — Citrinet-only in-page grader (int8 ONNX, onnxruntime-web WASM). */
(function (global) {
  const CACHE = '20261014-day4-trial';
  const DEFAULT_MODEL_BASE = 'https://mrjkorea.github.io/pronounce/';
  let modelBase = DEFAULT_MODEL_BASE;

  let booted = null;
  let trialApi = null;
  let trialModuleBase = '';

  function resolveTrialModuleBase() {
    if (trialModuleBase) return trialModuleBase;
    const scripts = document.getElementsByTagName('script');
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].src || '';
      if (src.indexOf('grade-browser.js') >= 0) {
        trialModuleBase = src.replace(/grade-browser\.js.*$/, '');
        return trialModuleBase;
      }
    }
    trialModuleBase = './pronounce/';
    return trialModuleBase;
  }

  function setBase(url) {
    if (url && String(url).trim()) {
      modelBase = String(url).replace(/\/?$/, '/');
    }
  }

  function emitProgress(onProgress, stage, pct) {
    if (typeof onProgress === 'function') {
      try { onProgress({ stage, pct }); } catch (_) {}
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const nodes = document.getElementsByTagName('script');
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].src === src && nodes[i].dataset.mrjReady === '1') {
          resolve();
          return;
        }
      }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => { s.dataset.mrjReady = '1'; resolve(); };
      s.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  function pageResult(result) {
    const doorFail = !!(result && result.doorFail);
    const rawWords = doorFail ? [] : ((result && result.words) || []);
    const words = rawWords.map((w) => ({
      word: w.word,
      score: (Number(w.score) || 0) / 100,
      hint: ''
    }));
    const score = doorFail ? 0 : (Number(result && result.score) || 0);
    const pass = doorFail ? false : !!(result && result.pass);
    const scorePct = doorFail ? 0 : Math.round(Number(result && result.scorePct) || score * 100);
    return Object.assign({}, result, {
      words,
      overall: { score, band: pass ? 'pass' : 'fail' },
      scorePct,
      pass,
      doorFail,
      reason: (result && result.reason) || '',
      model_id: 'citrinet-int8-onnx',
      meta: { scoring_mode: 'citrinet-only' }
    });
  }

  function modelPaths() {
    return [
      modelBase + 'models/citrinet/model.int8.onnx',
      modelBase + 'models/citrinet/sp_pieces.json'
    ];
  }

  async function load(onProgress) {
    if (booted) {
      const done = await booted;
      emitProgress(onProgress, 'done', 100);
      return done;
    }
    booted = (async () => {
      const ortSrc = modelBase + 'vendor/ort/ort.wasm.min.js?v=' + CACHE;
      const wasmPaths = modelBase + 'vendor/ort/';
      const trialSrc = resolveTrialModuleBase() + 'src/trial.js?v=' + CACHE;

      emitProgress(onProgress, 'download', 8);
      await loadScript(ortSrc);
      emitProgress(onProgress, 'download', 20);
      trialApi = await import(trialSrc);
      emitProgress(onProgress, 'session', 40);
      await trialApi.bootTrialInPage({
        mode: 'citrinet-only',
        loadHints: false,
        wasmPaths,
        paths: modelPaths(),
        ort: global.ort
      });
      emitProgress(onProgress, 'done', 100);
      return true;
    })().catch((e) => { booted = null; trialApi = null; throw e; });
    return booted;
  }

  async function grade(blob, text) {
    await load();
    const decode = global.decodeAudioToMono;
    if (typeof decode !== 'function') throw new Error('decodeAudioToMono is not on the page');
    const samples = await decode(blob, 16000);
    const graded = await trialApi.gradeTrialSamples(samples, text, 60, null, { hints: false });
    return pageResult(graded.result);
  }

  global.MRJPronounce = { setBase, load, grade };
})(window);
