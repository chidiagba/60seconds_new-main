#!/usr/bin/env node
// Usage: node run-chat-edit-delete-migration.js <YOUR_SUPABASE_ACCESS_TOKEN>
// Get token: https://supabase.com/dashboard/account/tokens

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_REF = 'rvvujgbaswecqohixgog';
const SQL_FILE = path.join(__dirname, 'sql_commands_for_supabase_tables', 'enable-chat-message-edit-delete.sql');

const token = process.argv[2];
if (!token) {
  console.error('\nUsage: node run-chat-edit-delete-migration.js <TOKEN>\n');
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
        Authorization: `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch {
          json = null;
        }

        if (res.statusCode >= 400) {
          console.error(`\nERROR ${label} - HTTP ${res.statusCode}:`);
          console.error(JSON.stringify(json || raw, null, 2));
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        if (json && !Array.isArray(json) && json.error) {
          console.error(`\nERROR ${label} - SQL error:`);
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
  console.log('\nStep 1 - Applying chat edit/delete SQL...');

  try {
    await post(sql, 'Apply SQL');
    console.log('SQL executed.\n');
  } catch {
    console.error('\nMigration failed - see error above.\n');
    process.exit(1);
  }

  console.log('Step 2 - Verifying group message policies...');
  const verify = `
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'group_chat_messages'
      AND policyname IN ('Members can update own messages', 'Members can delete own messages')
    ORDER BY policyname;
  `;

  try {
    const rows = await post(verify, 'Verify');
    const found = (rows || []).map((row) => row.policyname);
    console.log('Policies found:');
    found.forEach((name) => console.log(`  - ${name}`));
    console.log('\nDone. Reload the app and test group edit/delete again.\n');
  } catch {
    console.error('\nVerification failed, but the SQL may still have been applied.\n');
  }
}

main();