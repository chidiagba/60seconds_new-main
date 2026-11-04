const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the screen's actual submit handlers without mounting native camera/maps modules.
function screenHandler(business, overrides = {}) {
  const file = `app/(${business ? 'tabsbusiness' : 'tabs'})/upload.tsx`;
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = [];
  function visit(node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d =>
      ts.isIdentifier(d.name) && ['performUpload', 'handleUpload'].includes(d.name.text))) {
      declarations.push(node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const handlers = declarations.join('\n');
  const alerts = [];
  const preparing = [];
  const context = {
    uploadLaunchLockRef: { current: false }, preparingUploadRef: { current: false },
    isUploading: false, videoUri: null, flyerUri: null, videoDurationMs: null,
    eventName: 'Test event', eventLocation: { name: 'Test venue' },
    user: { user_type: business ? 'business' : 'private' }, authUser: null,
    eventDate: new Date('2026-10-16T08:00:00Z'), eventEndDate: null,
    getCurrentMinimumStartDate: () => new Date('2026-10-16T09:00:00Z'),
    getDefaultEndDate: start => new Date(start.getTime() + 3600000),
    applyStartDate() {}, applyEndDate() {}, buildFallbackEventTitle: () => 'Event',
    isVideoTooShort: () => false, isVideoTooLong: () => false,
    setIsPreparingUpload: value => preparing.push(value), setIsUploading() {},
    getUploadFailureMessage: error => error.message,
    Alert: { alert: (...args) => alerts.push(args) },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(handlers + '\nglobalThis.submit = handleUpload;', {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return { context, alerts, preparing };
}

for (const business of [false, true]) {
  const account = business ? 'business' : 'personal';
  test(`${account}: missing media gives feedback and releases preparation state`, async () => {
    const { context, alerts, preparing } = screenHandler(business);
    await context.submit();
    assert.equal(alerts[0][0], 'Missing Video');
    assert.deepEqual(preparing, [true, false]);
    assert.equal(context.preparingUploadRef.current, false);
  });
  test(`${account}: expired default start does not block submission`, async () => {
    const { context, alerts } = screenHandler(business, { videoUri: 'file:///event.mp4' });
    await context.submit();
    assert.equal(alerts[0][0], 'Authentication Error');
  });
  test(`${account}: preparation errors are visible and a retry is allowed`, async () => {
    const { context, alerts } = screenHandler(business, {
      videoUri: 'file:///event.mp4', authUser: { id: 'user' }, businessBankAccount: {},
      supabase: { auth: { getUser: async () => { throw new Error('Session unavailable'); } } },
    });
    await context.submit();
    await context.submit();
    assert.equal(alerts.length, 2);
    assert.equal(alerts[0][0], 'Upload Failed');
    assert.equal(context.uploadLaunchLockRef.current, false);
  });
}
