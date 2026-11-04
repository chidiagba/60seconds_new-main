const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const code = ts.transpileModule(fs.readFileSync('constants/app-links.ts','utf8'), { compilerOptions: { module:ts.ModuleKind.CommonJS } }).outputText;
function load(value) { const exports = {}; vm.runInNewContext(code,{exports,URL,process:{env:{EXPO_PUBLIC_SHARE_BASE_URL:value}}}); return exports; }
test('event links are public browser URLs even in development', () => {
  for (const origin of [undefined,'http://localhost:8081','http://192.168.1.5:8081','myapp://event','https://localhost','https://127.0.0.1','bad']) {
    assert.equal(load(origin).buildEventShareUrl('event-1'), 'https://events.60secondsapp.io/event-1');
  }
});
test('explicit HTTPS hosting origin and encoded IDs', () => {
  assert.equal(load('https://events.example.com/path/').buildEventShareUrl('a/b'), 'https://events.example.com/a%2Fb');
  assert.equal(load().buildVideoShareUrl('v'), 'https://events.60secondsapp.io/video/v');
});
test('browser entry includes app root and no unconditional app redirect', () => {
  const html=fs.readFileSync('public/index.html','utf8');
  assert.match(html, /id="root"/);
  assert.doesNotMatch(html, /myapp:\/\//);
});
