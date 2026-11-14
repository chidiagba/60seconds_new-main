const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync('supabase/functions/_shared/signupt.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {}, URL };
vm.runInNewContext(js, sandbox);
const { buildSignupTRegistrationUrl, classifySignupTResponse } = sandbox.exports;

test('builds SignupT query parameters without exposing key to client code', () => {
  const url = buildSignupTRegistrationUrl('otown-40rq', 'server-secret');
  assert.equal(url.origin, 'https://signupt.com');
  assert.equal(url.pathname, '/api/public/register');
  assert.equal(url.searchParams.get('ref'), 'otown-40rq');
  assert.equal(url.searchParams.get('key'), 'server-secret');
  assert.doesNotMatch(fs.readFileSync('lib/campaign-attribution.ts', 'utf8'), /SIGNUPT_API_KEY|server-secret/);
});

test('only an explicit provider success is reported; ambiguity is never replayed as success', () => {
  assert.equal(classifySignupTResponse(200, { success: true }), 'reported');
  assert.equal(classifySignupTResponse(200, { success: false }), 'unknown');
  assert.equal(classifySignupTResponse(200, 'ok'), 'unknown');
  assert.equal(classifySignupTResponse(503, { success: false }), 'unknown');
  assert.equal(classifySignupTResponse(401, { error: 'unauthorized' }), 'failed');
});
