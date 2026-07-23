// Render the lock-screen roll-call mockup to a webp that matches the other product shots
// (390x844 @3x = 1170x2532, webp via the same CDP path as shoot-proto.mjs).
import { launch, goto, screenshot, sleep } from './lib/cdp.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const HTML = pathToFileURL(join(process.cwd(), 'web', 'landing-src', 'lockscreen.html')).href;
const OUT = join(process.cwd(), 'web', 'landing', 'assets', 'product', 'vc-1-lockscreen.webp');

const b = await launch({ port: 9347, scale: 3 });
try {
  const page = await b.newPage({ width: 390, height: 844 });
  await goto(page, HTML, { settleMs: 700 });
  await sleep(400);
  const buf = await screenshot(page, { format: 'webp' });
  await writeFile(OUT, buf);
  console.log(`ok  vc-1-lockscreen.webp  ${Math.round(buf.length / 1024)}kb`);
  await b.send('Target.closeTarget', { targetId: page.targetId });
} finally {
  await b.close();
}
