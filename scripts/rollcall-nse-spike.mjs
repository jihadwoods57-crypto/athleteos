#!/usr/bin/env node
// OnStandard: the roll call v3 device spike (plan 2026-09-24, Task 1).
//
// Sends ONE push through Expo with `mutableContent` and a synthetic roll-call schedule in data.rc,
// exactly the shape the server will send (rollcall-notice.ts armPayload), with `diag: 1` so the
// Notification Service Extension writes what it did into the banner itself. No database row is
// involved: the instance id is random and there is no window code, so nothing is reported and a tap
// on the alarm records nothing on the server. The question is only whether the extension can arm.
//
//   node scripts/rollcall-nse-spike.mjs --token "ExponentPushToken[xxxx]" [--in 3]
//   node scripts/rollcall-nse-spike.mjs --token "ExponentPushToken[xxxx]" --cancel <instance uuid>
//   node scripts/rollcall-nse-spike.mjs --token "ExponentPushToken[xxxx]" --dry-run   # print, send nothing
//
// The token is the test phone's row in device_tokens:
//   supabase db query --linked "select t.token, t.platform, t.updated_at from device_tokens t join auth.users u on u.id = t.user_id where u.email = '<athlete email>' order by t.updated_at desc"
import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const token = arg('token');
if (!token || !/^ExponentPushToken\[.+\]$/.test(token)) {
  console.error('Pass --token "ExponentPushToken[...]" (the test phone\'s device_tokens.token).');
  process.exit(2);
}
const minutes = Math.max(1, Number(arg('in', '3')) || 3);
const cancelId = arg('cancel');
const dryRun = argv.includes('--dry-run');
const instanceId = randomUUID();
const atMs = Date.now() + minutes * 60_000;

const message = {
  to: token,
  title: 'Roll call test',
  body: 'Open OnStandard to set your alarm.',
  sound: 'default',
  priority: 'high',
  mutableContent: true,
  data: {
    rc: {
      v: 1,
      kind: cancelId ? 'cancelled' : 'assigned',
      title: 'Spike roll call',
      label: 'I’m Up',
      url: '',
      arm: cancelId ? [] : [{ i: instanceId, at: atMs }],
      cancel: cancelId ? [cancelId] : [],
      set: cancelId ? 'Spike: alarm removed' : 'Spike: alarm set ✓',
      diag: 1,
    },
  },
};

if (dryRun) {
  console.log(JSON.stringify([message], null, 2));
  process.exit(0);
}

const send = await fetch('https://exp.host/--/api/v2/push/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify([message]),
});
const ticket = await send.json();
console.log('ticket', JSON.stringify(ticket));
const id = ticket?.data?.[0]?.id;
if (!cancelId) console.log(`armed instance ${instanceId} for ${new Date(atMs).toLocaleTimeString()} (cancel with --cancel ${instanceId})`);
if (id) {
  // A ticket "ok" means Expo accepted; the receipt (about 20 s later) means Apple delivered.
  await new Promise((r) => setTimeout(r, 20_000));
  const rec = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }),
  });
  console.log('receipt', JSON.stringify(await rec.json()));
}
