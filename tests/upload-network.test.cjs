const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loadAssessment(fetch) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('utils/upload-network.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(source, { exports, fetch, AbortController, setTimeout, clearTimeout });
  return exports.assessUploadNetwork;
}

test('a successful connectivity probe allows upload', async () => {
  const assess = loadAssessment(async () => ({ ok: true, status: 204 }));
  assert.equal((await assess()).hint, 'online');
});

test('a blocked probe does not block a reachable upload server', async () => {
  const assess = loadAssessment(async () => { throw new TypeError('Network request failed'); });
  assert.equal((await assess()).hint, 'unknown');
});

test('a failed HTTP probe does not establish that the device is offline', async () => {
  const assess = loadAssessment(async () => ({ ok: false, status: 503 }));
  assert.equal((await assess()).hint, 'unknown');
});

test('a timed out probe permits the slow-network upload flow', async () => {
  const assess = loadAssessment((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
  }));
  assert.equal((await assess(5)).hint, 'weak');
});
