// Generate reviewable SQL from repository sources. This script never connects to a database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const checkout = [
  '20261111080000_voucher_production_bridge.sql',
  '20261111090000_atomic_voucher_checkout.sql',
  '20261111100000_verified_fulfillment_boundaries.sql',
  '20261113100000_secure_event_table_checkin.sql',
  '20261113110000_checkout_schema_cache_repair.sql',
];
const campaign = ['20261113130000_campaign_attribution.sql', '20261113190000_atomic_campaign_signup_attribution.sql'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function source(file) {
  return `\n-- SOURCE: ${file}\n-- SHA256: ${digest(fs.readFileSync(path.join(root, file)))}\n${fs.readFileSync(path.join(root, file), 'utf8')}\n`;
}
function gate(file) {
  // Strip only standalone transaction boundaries, never PL/pgSQL BEGIN blocks.
  return source(file).replace(/^BEGIN READ ONLY;\s*$/gm, '').replace(/^COMMIT;\s*$/gm, '');
}
function bundle(files, body) {
  const versions = files.map(file => `'${file.split('_')[0]}'`).join(',');
  const records = files.map(file => `('${file.split('_')[0]}','${file.replace(/^\d+_/, '').replace(/\.sql$/, '')}')`).join(',\n');
  return `-- Generated from repository sources. Review and rehearse before approved deployment.\nBEGIN;\nSET LOCAL lock_timeout='3s';\nSET LOCAL statement_timeout='120s';\nDO $preflight$ BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Missing migration history; inspect target before deployment';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261107130000') THEN
    RAISE EXCEPTION 'Expected production baseline missing';
  END IF;
  IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN (${versions})) THEN
    RAISE EXCEPTION 'Release partially/already applied; inspect history rather than replaying';
  END IF;
END $preflight$;\n${body}\n-- Record only migrations actually executed in this transaction.\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES\n${records};\nNOTIFY pgrst, 'reload schema';\nCOMMIT;\n`;
}
function prepare(output) {
  fs.mkdirSync(output, { recursive: true });
  const body = checkout.map((file, i) => source(`supabase/migrations/${file}`) + (i === 0 ? gate('scripts/check-voucher-release-prerequisites.sql') : '')).join('') + gate('scripts/assert-voucher-release.sql');
  const sql = bundle(checkout, body);
  const files = {
    '01_checkout_release.sql': sql,
    '01_checkout_release_REHEARSAL.sql': sql.replace(/COMMIT;\s*$/, 'ROLLBACK;\n'),
    '02_campaign_attribution.sql': bundle(campaign, campaign.map(file => source(`supabase/migrations/${file}`)).join('')),
  };
  for (const [file, value] of Object.entries(files)) fs.writeFileSync(path.join(output, file), value);
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), Object.entries(files).map(([file, value]) => `${digest(value)}  ${file}\n`).join(''));
  return Object.keys(files);
}
if (require.main === module) console.log(prepare(path.resolve(process.argv[2] || path.join(root, 'build/checkout-release'))).join('\n'));
module.exports = { prepare };
