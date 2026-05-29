#!/usr/bin/env node

/**
 * Usage:
 *   node seed-dummy-ticket-receipt.js <SUPABASE_ACCESS_TOKEN> [buyerEmail]
 *
 * Example:
 *   node seed-dummy-ticket-receipt.js sbp_xxx shoaibiqbal@gmail.com
 */

const https = require('https');

const PROJECT_REF = 'rvvujgbaswecqohixgog';
const token = process.argv[2];
const buyerEmail = process.argv[3] || 'shoaibiqbal@gmail.com';

if (!token) {
  console.error('Usage: node seed-dummy-ticket-receipt.js <SUPABASE_ACCESS_TOKEN> [buyerEmail]');
  process.exit(1);
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

function runQuery(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });

    const req = https.request(
      {
        hostname: 'api.supabase.com',
        path: `/v1/projects/${PROJECT_REF}/database/query`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // keep raw string
          }

          if (res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
          }

          if (parsed && !Array.isArray(parsed) && parsed.error) {
            return reject(new Error(`SQL error: ${JSON.stringify(parsed.error)}`));
          }

          resolve(parsed);
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function ensureTicketTable() {
  const sql = `
CREATE TABLE IF NOT EXISTS ticket_receipts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  order_number TEXT NOT NULL,
  buyer_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ticket_type TEXT,
  ticket_title TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  qr_code_data TEXT NOT NULL,
  ticket_image_url TEXT,
  pdf_url TEXT,
  seat_no TEXT,
  event_name TEXT,
  event_start_date TIMESTAMP WITH TIME ZONE,
  event_end_date TIMESTAMP WITH TIME ZONE,
  location_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`;

  await runQuery(sql);
}

async function main() {
  try {
    await ensureTicketTable();

    const userRows = await runQuery(`
      SELECT id, email
      FROM profiles
      WHERE lower(email) = lower('${escapeSql(buyerEmail)}')
      LIMIT 1;
    `);

    if (!Array.isArray(userRows) || userRows.length === 0) {
      throw new Error(`No profile found for email: ${buyerEmail}`);
    }

    const buyerId = userRows[0].id;

    const ownerRows = await runQuery(`
      SELECT p.business_id AS owner_id, p.event_id, p.id AS product_id, p.name AS ticket_title, e.video_id, e.event_name, e.start_date, e.end_date, e.location_name
      FROM products p
      LEFT JOIN events e ON e.id = p.event_id
      WHERE p.type = 'ticket'
      ORDER BY p.created_at DESC
      LIMIT 1;
    `);

    const fallbackOwnerRows = await runQuery(`
      SELECT id AS owner_id
      FROM profiles
      ORDER BY created_at DESC
      LIMIT 1;
    `);

    const selected = Array.isArray(ownerRows) && ownerRows[0] ? ownerRows[0] : {};
    const ownerId = selected.owner_id || (Array.isArray(fallbackOwnerRows) && fallbackOwnerRows[0] ? fallbackOwnerRows[0].owner_id : buyerId);

    const orderRows = await runQuery(`
      SELECT id
      FROM orders
      WHERE user_id = '${escapeSql(buyerId)}'
      ORDER BY created_at DESC
      LIMIT 1;
    `);

    let orderId = null;

    if (Array.isArray(orderRows) && orderRows.length > 0) {
      orderId = orderRows[0].id;
    } else {
      const createOrderRows = await runQuery(`
        INSERT INTO orders (
          user_id,
          order_date,
          items,
          payment_method,
          total_amount,
          status,
          created_at,
          updated_at
        ) VALUES (
          '${escapeSql(buyerId)}',
          NOW(),
          '[{"product_id":"dummy-product","quantity":1,"price":50,"name":"Dummy Ticket"}]'::jsonb,
          'manual-seed',
          50,
          'completed',
          NOW(),
          NOW()
        )
        RETURNING id;
      `);

      if (!Array.isArray(createOrderRows) || createOrderRows.length === 0) {
        throw new Error('Failed to create a dummy order for the buyer.');
      }

      orderId = createOrderRows[0].id;
    }

    const orderNumber = `ORD-${Date.now()}`;

    const now = Date.now();
    const seatNo = 'A12';
    const eventName = selected.event_name || '60seconds HQ Event';
    const locationName = selected.location_name || '60seconds HQ';
    const ticketTitle = selected.ticket_title || 'Dummy VIP Ticket';
    const eventStartDate = selected.start_date || new Date(now + 24 * 60 * 60 * 1000).toISOString();
    const eventEndDate = selected.end_date || new Date(now + 26 * 60 * 60 * 1000).toISOString();
    const qrCodeData = `TICKET:${orderNumber}:DUMMY:${now}`;

    const ticketImageUrl = `https://dummyimage.com/768x1100/10284c/ffffff.png&text=${encodeURIComponent(
      `60seconds\n${eventName}\n${seatNo}\n${orderNumber}`
    )}`;

    const insertRows = await runQuery(`
      INSERT INTO ticket_receipts (
        order_id,
        order_number,
        buyer_id,
        owner_id,
        video_id,
        event_id,
        product_id,
        ticket_type,
        ticket_title,
        quantity,
        unit_price,
        total_price,
        currency,
        qr_code_data,
        ticket_image_url,
        pdf_url,
        seat_no,
        event_name,
        event_start_date,
        event_end_date,
        location_name,
        is_active,
        issued_at
      ) VALUES (
        '${escapeSql(orderId)}',
        '${escapeSql(orderNumber)}',
        '${escapeSql(buyerId)}',
        '${escapeSql(ownerId)}',
        ${selected.video_id ? `'${escapeSql(selected.video_id)}'` : 'NULL'},
        ${selected.event_id ? `'${escapeSql(selected.event_id)}'` : 'NULL'},
        ${selected.product_id ? `'${escapeSql(selected.product_id)}'` : 'NULL'},
        'ticket',
        '${escapeSql(ticketTitle)}',
        1,
        50,
        50,
        'USD',
        '${escapeSql(qrCodeData)}',
        '${escapeSql(ticketImageUrl)}',
        'https://example.com/receipt/${escapeSql(orderNumber)}.pdf',
        '${escapeSql(seatNo)}',
        '${escapeSql(eventName)}',
        '${escapeSql(eventStartDate)}',
        '${escapeSql(eventEndDate)}',
        '${escapeSql(locationName)}',
        TRUE,
        NOW()
      )
      RETURNING id, order_number, buyer_id, owner_id, ticket_title, issued_at;
    `);

    console.log('Dummy ticket receipt inserted successfully:');
    console.log(JSON.stringify(insertRows, null, 2));

    const checkRows = await runQuery(`
      SELECT id, order_number, ticket_title, issued_at
      FROM ticket_receipts
      WHERE buyer_id = '${escapeSql(buyerId)}' OR owner_id = '${escapeSql(ownerId)}'
      ORDER BY issued_at DESC
      LIMIT 5;
    `);

    console.log('\nLatest visible tickets for profile tab query:');
    console.log(JSON.stringify(checkRows, null, 2));
  } catch (error) {
    console.error('Failed:', error.message || error);
    process.exit(1);
  }
}

main();
