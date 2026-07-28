// run: node --test supabase/functions/admin-alert/logic.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { escapeHtml, metaForKind, renderAlertEmail, buildResendPayload, shouldSend } from './logic.mjs';

test('escapeHtml neutralizes markup', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml(`O'Brien & "co" <x>`), 'O&#39;Brien &amp; &quot;co&quot; &lt;x&gt;');
});
test('escapeHtml handles null/undefined', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('metaForKind maps known kinds to severities', () => {
  assert.equal(metaForKind('account_locked').severity, 'critical');
  assert.equal(metaForKind('suspicious_login').severity, 'warning');
});
test('metaForKind falls back to info for unknown kinds (no throw)', () => {
  const m = metaForKind('made_up_kind');
  assert.equal(m.severity, 'info');
  assert.equal(m.headline, null);
});

test('renderAlertEmail produces both html and text, escapes attacker-influenced details', () => {
  const { html, text } = renderAlertEmail({
    kind: 'suspicious_login',
    subject: 'Suspicious Command Center sign-in',
    body: 'A sign-in from a new location was flagged.',
    details: [{ label: 'IP address', value: '9.9.9.9' }, { label: 'Country', value: '<script>bad</script>' }],
    actionUrl: 'https://onstandard-admin.gelatinous-twin.workers.dev/#/security',
    occurredAt: '2026-07-22T18:00:00.000Z',
  });
  assert.ok(html.includes('Suspicious sign-in detected'));
  assert.ok(html.includes('9.9.9.9'));
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(!html.includes('<script>bad</script>'), 'raw script tag must never appear unescaped');
  assert.ok(html.includes('Review sign-in activity'));
  assert.ok(html.includes('https://onstandard-admin.gelatinous-twin.workers.dev/#/security'));
  assert.ok(text.includes('Suspicious sign-in detected'));
  assert.ok(text.includes('IP address: 9.9.9.9'));
});

test('renderAlertEmail without details/actionUrl still renders cleanly', () => {
  const { html } = renderAlertEmail({ kind: 'recovery_used', subject: 'Recovery code used', body: 'A recovery code was used.' });
  assert.ok(html.includes('Two-factor authentication was reset'));
  assert.ok(!html.includes('undefined'));
});

test('buildResendPayload wraps subject and sets reply_to', () => {
  const p = buildResendPayload({
    from: 'OnStandard Security <alerts@onstandard.app>', to: 'you@onstandard.app', replyTo: 'you@onstandard.app',
    kind: 'account_locked', subject: 'Account temporarily locked', body: 'Too many failed attempts.',
  });
  assert.equal(p.from, 'OnStandard Security <alerts@onstandard.app>');
  assert.deepEqual(p.to, ['you@onstandard.app']);
  assert.equal(p.reply_to, 'you@onstandard.app');
  assert.equal(p.subject, 'OnStandard Security: Account temporarily locked');
  assert.ok(p.html.includes('locked'));
  assert.ok(p.text.length > 0);
});

test('dedupe suppresses a repeat kind', () => assert.equal(shouldSend(['new_country'], 'new_country'), false));
test('dedupe allows a fresh kind', () => {
  assert.equal(shouldSend(['new_country'], 'impossible_travel'), true);
  assert.equal(shouldSend([], 'new_country'), true);
});
