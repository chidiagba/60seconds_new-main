const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loadVenueLocation() {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('utils/venue-location.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports });
  return exports;
}

for (const platform of ['ios', 'android']) {
  test(`${platform}: an already-granted location resolves to an address and valid venue coordinates`, async () => {
    const { resolveCurrentVenueSelection } = loadVenueLocation();
    const calls = [];
    const selection = await resolveCurrentVenueSelection({
      getPermission: async () => ({ status: 'granted' }),
      getPosition: async () => { calls.push('position'); return { coords: { latitude: 37.78, longitude: -122.41 } }; },
      reverseGeocode: async coords => {
        calls.push(coords);
        return [{ name: 'Venue', street: 'Market St', city: 'San Francisco', country: 'US' }];
      },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), ['position', { latitude: 37.78, longitude: -122.41 }]);
    assert.deepEqual(JSON.parse(JSON.stringify(selection)), {
      latitude: 37.78, longitude: -122.41, name: 'Venue, Market St, San Francisco, US', city: 'San Francisco', country: 'US',
    });
  });

  test(`${platform}: denied location is graceful and does not request a position`, async () => {
    const { resolveCurrentVenueSelection } = loadVenueLocation();
    let positionRequested = false;
    const selection = await resolveCurrentVenueSelection({
      getPermission: async () => ({ status: 'denied' }),
      getPosition: async () => { positionRequested = true; return null; },
      reverseGeocode: async () => [],
    });
    assert.equal(selection, null);
    assert.equal(positionRequested, false);
  });

  test(`${platform}: reverse-geocode failure keeps valid coordinates editable`, async () => {
    const { resolveCurrentVenueSelection } = loadVenueLocation();
    const selection = await resolveCurrentVenueSelection({
      getPermission: async () => ({ status: 'granted' }),
      getPosition: async () => ({ coords: { latitude: 6.5244, longitude: 3.3792 } }),
      reverseGeocode: async () => { throw new Error('geocoder unavailable'); },
    });
    assert.equal(selection.name, '6.524400, 3.379200');
    assert.equal(selection.latitude, 6.5244);
    assert.equal(selection.longitude, 3.3792);
  });
}

test('both upload routes auto-fill only an already-granted location and reopen the map at the selected venue', () => {
  for (const path of ['app/(tabs)/upload.tsx', 'app/(tabsbusiness)/upload.tsx']) {
    const source = fs.readFileSync(path, 'utf8');
    assert.match(source, /resolveCurrentVenueSelection\(/);
    assert.match(source, /requestPermission:\s*false/);
    assert.match(source, /initialLatitude/);
    assert.match(source, /initialLongitude/);
  }
  const map = fs.readFileSync('app/location.tsx', 'utf8');
  assert.match(map, /params\.initialLatitude/);
  assert.match(map, /setSelectedLocation\(existingVenue\)/);
  assert.match(map, /reverseToName\(existingVenue\)/);
});
