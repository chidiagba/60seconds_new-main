const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('supabase/functions/_shared/guest-fulfillment.ts', 'utf8');
const emailCode = source.slice(source.indexOf('    const subject ='), source.indexOf('    const { error: emailError }'));
const deliver = new (Object.getPrototypeOf(async function(){}).constructor)('Deno', 'fetch', 'order', 'html', 'attachments', require('typescript').transpile(emailCode, { target: require('typescript').ScriptTarget.ES2022 }));
const env = { env: { get: key => ({ GUEST_EMAIL_PROVIDER: 'sendgrid', SENDGRID_API_KEY: 'test-key' })[key] } };
const order = { order_number: '123', guest_email: 'buyer@example.com' };
const attachments = [{ Name: 'qr-0.png', Content: 'base64', ContentType: 'image/png', ContentID: 'cid:qr-0' }];
test('SendGrid receipt preserves buyer, sender and inline QR reference', async () => {
  let payload;
  await deliver(env, async (url, options) => {
    assert.equal(url, 'https://api.sendgrid.com/v3/mail/send');
    payload = JSON.parse(options.body);
    return { ok: true, status: 202 };
  }, order, '<img src="cid:qr-0">', attachments);
  assert.equal(payload.personalizations[0].to[0].email, order.guest_email);
  assert.equal(payload.from.email, 'support@60secondsapp.io');
  assert.equal(payload.attachments[0].content_id, 'qr-0');
  assert.equal(payload.attachments[0].content, 'base64');
  assert.equal(payload.attachments[0].disposition, 'inline');
  assert.equal(payload.content[1].value, '<img src="cid:qr-0">');
});
test('Rejected email remains retryable instead of being marked delivered', async () => {
  await assert.rejects(deliver(env, async () => ({ ok: false, status: 403 }), order, '', attachments), /Email delivery failed \(403\)/);
});
