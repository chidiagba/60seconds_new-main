#!/usr/bin/env node
// Usage:  node run-group-chat-migration.js <YOUR_SUPABASE_ACCESS_TOKEN>
// Get token: https://supabase.com/dashboard/account/tokens

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_REF = 'rvvujgbaswecqohixgog';
const SQL_FILE = path.join(__dirname, 'sql_commands_for_supabase_tables', 'create-group-chat-tables.sql');

const token = process.argv[2];
if (!token) {
  console.error('\nUsage: node run-group-chat-migration.js <TOKEN>\n');
  process.exit(1);
}

const sql = fs.readFileSync(SQL_FILE, 'utf8');

function post(queryString, label) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: queryString });
    const opts = {
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        if (res.statusCode >= 400) {
          console.error(`\n❌  ${label} - HTTP ${res.statusCode}:`);
          console.error(JSON.stringify(json || raw, null, 2));
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        if (json && !Array.isArray(json) && json.error) {
          console.error(`\n❌  ${label} - SQL error:`);
          console.error(JSON.stringify(json.error, null, 2));
          return reject(new Error(String(json.error)));
        }
        resolve(json);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('\nStep 1 - Running migration SQL...');
  try {
    await post(sql, 'Migration');
    console.log('Migration SQL executed.\n');
  } catch {
    console.error('\nMigration failed - see error above.\n');
    process.exit(1);
  }

  console.log('Step 2 - Verifying tables exist...');
  const verify = `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('group_chats','group_chat_members','group_chat_messages') ORDER BY table_name;`;
  try {
    const rows = await post(verify, 'Verify');
    const found = (rows || []).map((r) => r.table_name);
    const missing = ['group_chat_members','group_chat_messages','group_chats'].filter((t) => !found.includes(t));
    if (missing.length === 0) {
      console.log('All 3 tables confirmed:');
      found.forEach((n) => console.log('  - ' + n));
      console.log('\nDone! Reload the app on your device.\n');
    } else {
      console.error('MISSING tables:', missing);
    }
  } catch {}
}

main();
