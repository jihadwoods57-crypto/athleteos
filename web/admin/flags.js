// OnStandard — founder feature-flags panel. Uses ONLY the anon key + the founder's login JWT.
// Every read/write goes through platform-admin-gated RPCs (admin_list_flags / admin_set_flag);
// a non-admin (or signed-out visitor) gets nothing. Built with DOM APIs + textContent (no
// innerHTML), so founder-entered allowlist values can never be interpreted as markup.
//
// SETUP (founder): fill SUPABASE_URL + SUPABASE_ANON_KEY below with the project's values. The
// anon (publishable) key is safe to ship here; the service-role key must NEVER appear on this page.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = ''; // TODO(founder): project URL, e.g. https://xxxx.supabase.co
const SUPABASE_ANON_KEY = ''; // TODO(founder): anon / publishable key — NOT the service role key
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const show = (el, on) => el.classList.toggle('hidden', !on);

function labeledCheckbox(text, checked) {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!checked;
  label.appendChild(box);
  label.appendChild(document.createTextNode(' ' + text));
  return { label, box };
}

function csvField(label, values) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.appendChild(document.createTextNode(label + ' '));
  const input = document.createElement('input');
  input.type = 'text';
  input.value = (values || []).join(',');
  wrap.appendChild(input);
  return { wrap, input };
}

function renderRow(f) {
  const row = document.createElement('div');
  row.className = 'row';

  const head = document.createElement('div');
  const name = document.createElement('b');
  name.textContent = f.name;
  head.appendChild(name);
  if (f.kill_switch) {
    const killed = document.createElement('span');
    killed.className = 'kill';
    killed.textContent = ' · KILLED';
    head.appendChild(killed);
  }
  row.appendChild(head);

  const desc = document.createElement('div');
  desc.className = 'muted';
  desc.textContent = f.description || '';
  row.appendChild(desc);

  const toggles = document.createElement('div');
  const def = labeledCheckbox('default on', f.default_on);
  const kill = labeledCheckbox('kill-switch', f.kill_switch);
  toggles.appendChild(def.label);
  toggles.appendChild(kill.label);
  row.appendChild(toggles);

  const users = csvField('users:', f.enabled_user_ids);
  const roles = csvField('roles:', f.enabled_roles);
  const orgs = csvField('orgs: ', f.enabled_org_ids);
  row.appendChild(users.wrap);
  row.appendChild(roles.wrap);
  row.appendChild(orgs.wrap);

  const save = document.createElement('button');
  save.textContent = 'Save';
  save.onclick = async () => {
    const csv = (input) => input.value.split(',').map((s) => s.trim()).filter(Boolean);
    save.disabled = true;
    const { error } = await sb.rpc('admin_set_flag', {
      p_name: f.name,
      p_description: f.description || '',
      p_default_on: def.box.checked,
      p_kill_switch: kill.box.checked,
      p_enabled_user_ids: csv(users.input),
      p_enabled_roles: csv(roles.input),
      p_enabled_org_ids: csv(orgs.input),
    });
    save.disabled = false;
    if (error) alert('Save failed: ' + error.message);
    else refresh();
  };
  const saveWrap = document.createElement('div');
  saveWrap.className = 'field';
  saveWrap.appendChild(save);
  row.appendChild(saveWrap);

  return row;
}

async function refresh() {
  const box = $('rows');
  const { data, error } = await sb.rpc('admin_list_flags');
  if (error) {
    box.textContent = 'Not authorized or unavailable: ' + error.message;
    return;
  }
  box.textContent = '';
  if (!data || !data.length) {
    box.textContent = 'No flags yet.';
    return;
  }
  for (const f of data) box.appendChild(renderRow(f));
}

async function gate() {
  const { data } = await sb.auth.getSession();
  const signedIn = !!data.session;
  show($('login'), !signedIn);
  show($('app'), signedIn);
  if (signedIn) refresh();
}

$('signin').onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value, password: $('pw').value });
  if (error) { $('loginerr').textContent = error.message; return; }
  gate();
};
$('signout').onclick = async () => { await sb.auth.signOut(); gate(); };

gate();
