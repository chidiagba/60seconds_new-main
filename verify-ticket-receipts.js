#!/usr/bin/env node
const https = require('https');

const token = process.argv[2];
if (!token) {
  console.error('Usage: node verify-ticket-receipts.js <SUPABASE_PAT>');
  process.exit(1);
}

const queries = [
  {
    name: 'grants',
    sql: "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='ticket_receipts' ORDER BY grantee, privilege_type;",
  },
  {
    name: 'policies',
    sql: "SELECT policyname, roles, cmd FROM pg_policies WHERE schemaname='public' AND tablename='ticket_receipts' ORDER BY policyname;",
  },
  {
    name: 'tickets',
    sql: "SELECT id, order_number, ticket_title, pdf_url FROM ticket_receipts WHERE buyer_id='5bb37b6c-d3bc-42f4-99e9-d21bfdb3af07' ORDER BY issued_at DESC LIMIT 3;",
  },
];

function runQuery(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const req = https.request(
      {
        hostname: 'api.supabase.com',
        path: '/v1/projects/rvvujgbaswecqohixgog/database/query',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw);
          }
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  for (const query of queries) {
    const result = await runQuery(query.sql);
    console.log(`\n[${query.name}]`);
    console.log(JSON.stringify(result, null, 2));
  }
})();
