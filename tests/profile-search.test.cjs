const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, requireStub) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: requireStub });
  return exports;
}
const { profileSearchFilter } = load('lib/profile-search.ts');
for (const query of ['@lekki_street_boy', 'lekki_street_boy', ' Lekki ', '@Lekki', 'Lekki street boy', '@lekki street boy']) {
  test(`username search matches ${JSON.stringify(query)}`, () => {
    const filter = profileSearchFilter(query);
    const pattern = JSON.parse(filter.slice('username.ilike.'.length).split(',full_name.ilike.')[0]);
    const regex = pattern.replace(/\\(.)|([%_])|([.*+?^${}()|[\]\\])/g,
      (_, escaped, wildcard, special) => escaped ? `\\${escaped}` : wildcard === '%' ? '.*' : wildcard === '_' ? '.' : `\\${special}`);
    assert.match('lekki_street_boy', new RegExp(`^${regex}$`, 'i'));
    if (/street/i.test(query)) assert.doesNotMatch('lekkiXstreetYboy', new RegExp(`^${regex}$`, 'i'));
  });
}
test('PostgREST punctuation stays inside quoted values and SQL wildcards stay literal', () => {
  const filter = profileSearchFilter('a,b("x")%_');
  const value = JSON.parse(filter.slice('username.ilike.'.length).split(',full_name.ilike.')[0]);
  assert.equal(value, '%a,b("x")\\%\\_%');
});
function searchStore() {
  let state;
  const pending = [];
  const exports = load('store/search-store.ts', name => {
    if (name === 'zustand') return { create: () => initializer => {
      state = initializer(update => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; }, () => state);
      return () => state;
    }};
    if (name === 'zustand/middleware') return { persist: fn => fn, createJSONStorage() {} };
    if (name === '@/lib/database') return { searchService: { searchAll: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) } };
    if (name === '@/lib/logger') return { logger: require('./logger-fixture.cjs') };
    return {};
  });
  return { get: exports.useSearchStore, pending };
}
test('a slower earlier request cannot overwrite the latest results', async () => {
  const f = searchStore();
  const old = f.get().performSearch('L');
  const latest = f.get().performSearch('Lekki');
  f.pending[1].resolve({ users: [{ username: 'lekki_street_boy' }] });
  await latest;
  f.pending[0].resolve({ users: [] });
  await old;
  assert.equal(f.get().searchResults.users[0].username, 'lekki_street_boy');
  assert.equal(f.get().isLoading, false);
});
test('clearing search prevents in-flight results from returning', async () => {
  const f = searchStore();
  const request = f.get().performSearch('Lekki');
  f.get().clearSearchResults();
  f.pending[0].resolve({ users: [{ username: 'lekki_street_boy' }] });
  await request;
  assert.equal(f.get().searchResults, null);
  assert.equal(f.get().isLoading, false);
});
test('typing a new query ignores an earlier error before the next search starts', async () => {
  const f = searchStore();
  const request = f.get().performSearch('L');
  f.get().setSearchQuery('Lekki');
  f.pending[0].reject(new Error('old request failed'));
  await request;
  assert.equal(f.get().error, null);
});
function unifiedSearch(profileError = null) {
  const source = ts.createSourceFile('database.ts', fs.readFileSync('lib/database.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let method;
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'searchAll') method = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const filters = [];
  const context = { profileSearchFilter, PUBLIC_OPEN_EVENT_STATUSES: ['published', 'open'],
    logger: require('./logger-fixture.cjs'), supabase: { from(table) {
      const builder = { select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; },
        or(value) { if (table === 'profiles') filters.push(value); return this; },
        limit() { return Promise.resolve({ data: table === 'profiles' ? [{ username: 'lekki_street_boy' }] : [], error: table === 'profiles' ? profileError : null }); },
      };
      return builder;
    } },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`globalThis.service = { ${method}, resolveFirstVideoForEvents: async rows => rows };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return { service: context.service, filters };
}
test('unified search uses normalized profile matching and includes accounts in total results', async () => {
  const f = unifiedSearch();
  const result = await f.service.searchAll('@lekki_street_boy');
  assert.equal(result.users[0].username, 'lekki_street_boy');
  assert.equal(result.totalResults, 1);
  assert.ok(f.filters[0].startsWith(profileSearchFilter('@lekki_street_boy')));
});
test('a profile query failure is reported instead of shown as no matching accounts', async () => {
  const error = new Error('profile search unavailable');
  await assert.rejects(unifiedSearch(error).service.searchAll('Lekki'), /profile search unavailable/);
});
