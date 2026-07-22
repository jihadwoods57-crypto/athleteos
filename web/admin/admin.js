// OnStandard — Command Center entry. Thin: it gates access via the server-authoritative admin_bootstrap
// (the client never decides who is admin), mounts the nav shell, and wires sign-in/out + refresh. Every
// section is a self-contained module; the data + rendering live there. Publishable key + login JWT only.
import { sb, bootstrap } from './api.js';
import { show, h, $, setIdentity } from './ui.js';
import { mountShell, refreshActive } from './shell.js';
import home from './sections/home.js';
import users from './sections/users.js';
import orgs from './sections/orgs.js';
import revenue from './sections/revenue.js';
import ai from './sections/ai.js';
import errors from './sections/errors.js';
import audit from './sections/audit.js';
import support from './sections/support.js';
import config from './sections/config.js';

// Registry — nav order follows this list, grouped by each section's rail.
const SECTIONS = [home, users, orgs, revenue, ai, errors, support, audit, config];

async function gate() {
  const { data } = await sb.auth.getSession();
  if (!data.session) { show($('login'), true); show($('app'), false); showDenied(false); return; }
  let boot;
  try { boot = await bootstrap(); } catch { boot = { is_admin: false }; }
  if (!boot || !boot.is_admin) {
    show($('login'), false); show($('app'), false); showDenied(true);
    return;
  }
  show($('login'), false); showDenied(false); show($('app'), true);
  setIdentity(boot.email);
  mountShell(SECTIONS, boot);
}

// Signed in, but not a platform admin — a clean, honest state (not a broken shell full of errors).
function showDenied(on) {
  let d = $('denied');
  if (!d) {
    d = h('div', { id: 'denied', class: 'login hidden' }, [h('div', { class: 'card' }, [
      h('div', { class: 'brand', style: 'margin-bottom:14px' }, [h('span', { class: 'mark' }), h('div', {}, ['OnStandard', h('small', { text: 'Command Center' })])]),
      h('h1', { text: 'Access denied' }),
      h('p', { text: 'This account is signed in but is not a platform admin. Ask an existing admin to add you to the platform_admins allowlist.' }),
      h('div', { style: 'height:14px' }),
      h('button', { class: 'btn', text: 'Sign out', onclick: async () => { await sb.auth.signOut(); location.reload(); } }),
    ])]);
    document.body.appendChild(d);
  }
  show(d, on);
}

$('signin').onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pw').value });
  if (error) { $('loginerr').textContent = error.message; return; }
  gate();
};
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('signin').click(); });
$('signout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
$('refresh').onclick = () => refreshActive();
gate();
