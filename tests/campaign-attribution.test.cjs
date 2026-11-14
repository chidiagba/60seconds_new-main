const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('lib/campaign-attribution.ts', 'utf8');
const pattern = /^[a-z0-9][a-z0-9_-]{2,39}$/i;
function normalize(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase();
  return code.length <= 40 && pattern.test(code) ? code : null;
}
function parse(value) {
  try {
    const decoded = decodeURIComponent(value);
    const query = decoded.includes('?') ? decoded.slice(decoded.indexOf('?') + 1) : decoded;
    return normalize(new URLSearchParams(query).get('ref') || decoded);
  } catch { return null; }
}

test('referral service applies bounded code syntax and canonical lowercase', () => {
  assert.match(source, /REFERRAL_PATTERN = \/\^\[a-z0-9\]/);
  assert.equal(normalize(' OTOWN-40RQ '), 'otown-40rq');
  assert.equal(normalize('creator-a123'), 'creator-a123');
  assert.equal(normalize('../bad'), null);
  assert.equal(normalize('a'), null);
});

test('encoded store referrer values decode to validated referral codes', () => {
  assert.match(source, /decodeURIComponent\(value\)/);
  assert.equal(parse('ref%3Dotown-40rq'), 'otown-40rq');
  assert.equal(parse('utm_source=x&ref=creator-b456'), 'creator-b456');
  assert.equal(parse('%E0%A4%A'), null);
});
