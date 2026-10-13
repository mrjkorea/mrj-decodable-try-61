#!/usr/bin/env node
'use strict';

/**
 * Headless Chrome benchmark: MRJPronounce Citrinet-only grader on decodable reader assets.
 * node test/bench-speak-citrinet.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WAV_DIR = path.join(__dirname, 'bench-wavs');
const TARGET = 'It is here.';
const CLIPS = [
  { id: 'correct', file: 'correct-it-is-here.wav' },
  { id: 'wrong', file: 'wrong-what-time.wav' },
  { id: 'silence', file: 'silence.wav' },
  { id: 'mumbled', file: 'mumbled-it-is-here.wav' },
];

function startStaticServer() {
  const mime = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.wav': 'audio/wav',
    '.onnx': 'application/octet-stream',
    '.wasm': 'application/wasm',
    '.mjs': 'text/javascript',
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
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

async function main() {
  const { server, baseUrl } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(300000);

  const bootStart = Date.now();
  await page.goto(baseUrl + 'index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MRJPronounce && window.decodeAudioToMono, { timeout: 15000 });
  await page.evaluate(async () => {
    window.MRJPronounce.setBase('https://mrjkorea.github.io/pronounce-try/');
    await window.MRJPronounce.load();
  });
  const bootMs = Date.now() - bootStart;

  const results = [];
  for (const clip of CLIPS) {
    const wavPath = path.join(WAV_DIR, clip.file);
    const wavB64 = (await readFile(wavPath)).toString('base64');
    const t0 = Date.now();
    const row = await page.evaluate(async ({ b64, target }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const tGrade = performance.now();
      const j = await window.MRJPronounce.grade(blob, target);
      return {
        scorePct: j.scorePct,
        pass: j.pass,
        doorFail: j.doorFail,
        model_id: j.model_id,
        meta: j.meta,
        gradeMs: Math.round(performance.now() - tGrade),
      };
    }, { b64: wavB64, target: TARGET });
    results.push({ id: clip.id, wallMs: Date.now() - t0, ...row });
  }

  await browser.close();
  server.close();

  const summary = { bootMs, clips: results };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
