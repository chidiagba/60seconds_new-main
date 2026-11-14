const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function fixture(platform, status = 'undetermined', storage = new Map(), action = 'Continue') {
  let alerts = 0, requests = 0;
  const permission = { status, canAskAgain: true };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('utils/location.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require(name) {
    if (name === 'expo-location') return {
      getForegroundPermissionsAsync: async () => permission,
      requestForegroundPermissionsAsync: async () => { requests++; permission.status = 'granted'; return permission; },
    };
    if (name === 'react-native') return { Platform: { OS: platform }, Alert: { alert(title, text, buttons, options) {
      alerts++;
      if (action === 'dismiss') options.onDismiss();
      else buttons.find(button => button.text === action).onPress();
    } } };
    if (name === '@react-native-async-storage/async-storage') return { default: {
      getItem: async key => storage.get(key) || null,
      setItem: async (key, value) => { storage.set(key, value); },
    } };
    return { logger: require('./logger-fixture.cjs') };
  } });
  return { request: exports.requestForegroundLocationPermission, counts: () => [alerts, requests], permission, storage };
}
for (const platform of ['android', 'ios']) {
  test(`${platform}: granted permission never shows an introduction or system prompt`, async () => {
    const f = fixture(platform, 'granted');
    await f.request(); await f.request();
    assert.deepEqual(f.counts(), [0, 0]);
  });
  test(`${platform}: concurrent first requests share one introduction and permission prompt`, async () => {
    const f = fixture(platform);
    await Promise.all([f.request(), f.request(), f.request()]);
    assert.deepEqual(f.counts(), [1, 1]);
    await f.request();
    assert.deepEqual(f.counts(), [1, 1]);
  });
  for (const action of ['Not now', 'dismiss']) {
    test(`${platform}: ${action} is remembered across calls and app restarts`, async () => {
      const f = fixture(platform, 'undetermined', new Map(), action);
      await f.request(); await f.request();
      assert.deepEqual(f.counts(), [1, 0]);
      const restarted = fixture(platform, 'undetermined', f.storage);
      await restarted.request();
      assert.deepEqual(restarted.counts(), [0, 0]);
    });
  }
  test(`${platform}: denied permission is not requested again automatically`, async () => {
    const f = fixture(platform, 'denied');
    await f.request();
    assert.deepEqual(f.counts(), [0, 0]);
  });
  test(`${platform}: existing disclosure acceptance skips the introduction`, async () => {
    const f = fixture(platform, 'undetermined', new Map([['location_disclosure_accepted_v1', 'true']]));
    await f.request();
    assert.deepEqual(f.counts(), [0, 1]);
  });
}
