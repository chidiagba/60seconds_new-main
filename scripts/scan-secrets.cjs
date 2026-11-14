const fs = require('node:fs');
const cp = require('node:child_process');
const patterns = [
  /sk_(?:live|test)_[A-Za-z0-9]{16,}/,
  /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/,
  /AIza[\w-]{30,}/,
  /cloudinary:\/\/[^\s'"<>]+:[^\s'"<>]+@/,
  /eyJhbGci[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+/,
];
let failures = 0;
// Inspect tracked and new source, respecting .gitignore. Never print matched secret values.
const files = cp.execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0');
for (const file of new Set(files)) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  if (/\.(?:jks|keystore|key)$/.test(file) && !file.endsWith('debug.keystore')) { console.error(`Private key material: ${file}`); failures++; continue; }
  if (fs.statSync(file).size > 2_000_000) continue;
  const source = fs.readFileSync(file,'utf8');
  if (patterns.some(pattern=>pattern.test(source))) { console.error(`Possible embedded credential: ${file}`); failures++; }
}
if (!failures) console.log('No embedded credentials detected in working source');
process.exitCode = failures ? 1 : 0;
