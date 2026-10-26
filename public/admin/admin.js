// Admin console. Same-origin fetches carry the HTTP Basic credentials the
// browser already prompted for, so no extra auth handling is needed here.

const $ = (id) => document.getElementById(id);
const COLOR_KEYS = [
  ['primary', 'Primary'], ['primaryText', 'Primary text'], ['accent', 'Accent'],
  ['background', 'Background'], ['surface', 'Surface'], ['text', 'Text'], ['muted', 'Muted'],
];
let editing = null;

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function msg(el, text, kind) { el.textContent = text; el.className = 'msg ' + kind; if (text) setTimeout(() => { if (el.textContent === text) el.className = 'msg'; }, 4000); }

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} error`);
  return data;
}

// ---- Connection ----
async function loadConnection() {
  const c = await api('GET', '/api/admin/connection');
  $('c-url').value = c.url || '';
  $('c-apiPath').value = c.apiPath || 'api/v5';
  $('c-username').value = c.username || '';
  $('c-password').placeholder = c.hasPassword ? '•••••••• (saved)' : 'password';
  $('c-requestor').value = c.requestor || '';
  $('c-orgField').value = c.orgField || 'customer';
  $('c-orgQuery').value = c.orgQuery || '';
}
$('c-save').addEventListener('click', async () => {
  try {
    const body = {
      url: $('c-url').value, apiPath: $('c-apiPath').value, username: $('c-username').value,
      requestor: $('c-requestor').value, orgField: $('c-orgField').value, orgQuery: $('c-orgQuery').value,
    };
    if ($('c-password').value) body.password = $('c-password').value;
    await api('PUT', '/api/admin/connection', body);
    $('c-password').value = '';
    await loadConnection();
    msg($('c-msg'), 'Connection saved.', 'ok');
  } catch (e) { msg($('c-msg'), e.message, 'err'); }
});
$('c-test').addEventListener('click', async () => {
  msg($('c-msg'), 'Testing…', 'ok');
  try {
    const r = await api('POST', '/api/admin/connection/test');
    msg($('c-msg'), `Connected (${r.mode} mode).`, 'ok');
  } catch (e) { msg($('c-msg'), 'Failed: ' + e.message, 'err'); }
});

// ---- Forms list ----
async function loadForms() {
  const { forms } = await api('GET', '/api/admin/forms');
  $('f-list').innerHTML = forms.length ? forms.map((f) => `
    <tr>
      <td><strong>${esc(f.productName || f.name)}</strong><br><span class="muted">/f/${esc(f.id)}</span></td>
      <td><span class="pill ${f.enabled ? 'on' : 'off'}">${f.enabled ? 'Published' : 'Draft'}</span></td>
      <td style="text-align:right">
        <a href="/f/${encodeURIComponent(f.id)}" target="_blank" class="muted">Open ↗</a>
        <button class="small" data-edit="${esc(f.id)}">Edit</button>
      </td>
    </tr>`).join('') : '<tr><td class="muted">No forms yet.</td></tr>';
  document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditor(b.dataset.edit)));
}
$('f-create').addEventListener('click', async () => {
  const name = $('f-new-name').value.trim();
  if (!name) return msg($('f-msg'), 'Enter a name.', 'err');
  try {
    const form = await api('POST', '/api/admin/forms', { name });
    $('f-new-name').value = '';
    await loadForms();
    openEditor(form.id);
  } catch (e) { msg($('f-msg'), e.message, 'err'); }
});

// ---- Editor ----
function colorInputs(colors) {
  $('colors').innerHTML = COLOR_KEYS.map(([k, label]) =>
    `<div><label>${label}</label><input data-color="${k}" type="color" value="${esc(colors[k] || '#000000')}"></div>`
  ).join('');
}
function fieldRow(f = {}) {
  const div = document.createElement('div');
  div.className = 'field-row';
  div.innerHTML = `
    <input class="fk" placeholder="firstname" value="${esc(f.key || '')}">
    <input class="fl" placeholder="First name" value="${esc(f.label || '')}">
    <select class="ft">${['text', 'email', 'tel', 'number'].map((t) => `<option ${f.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <select class="fr"><option value="true" ${f.required ? 'selected' : ''}>Yes</option><option value="false" ${!f.required ? 'selected' : ''}>No</option></select>
    <input class="fh" placeholder="help text" value="${esc(f.help || '')}">
    <button class="small danger" title="Remove">✕</button>`;
  div.querySelector('button').addEventListener('click', () => div.remove());
  return div;
}
async function openEditor(id) {
  editing = await api('GET', `/api/admin/forms/${encodeURIComponent(id)}`);
  $('editor').classList.remove('hidden');
  $('e-title').textContent = editing.name;
  $('e-link').textContent = `${location.origin}/f/${editing.id}`;
  $('e-link').href = `/f/${editing.id}`;
  $('e-name').value = editing.name || '';
  $('e-enabled').value = String(editing.enabled !== false);
  $('e-productName').value = editing.productName || '';
  $('e-tagline').value = editing.tagline || '';
  $('e-intro').value = editing.intro || '';
  $('e-successMessage').value = editing.successMessage || '';
  $('e-logoUrl').value = editing.logoUrl || '';
  $('e-orgQuery').value = editing.orgQuery || '';
  $('e-orgField').value = editing.orgField || '';
  $('e-roles').value = editing.roles || '';
  colorInputs(editing.colors || {});
  $('fields').innerHTML = '';
  (editing.fields || []).forEach((f) => $('fields').appendChild(fieldRow(f)));
  $('editor').scrollIntoView({ behavior: 'smooth' });
}
$('add-field').addEventListener('click', () => $('fields').appendChild(fieldRow()));
$('e-close').addEventListener('click', () => { $('editor').classList.add('hidden'); editing = null; });
$('e-save').addEventListener('click', async () => {
  const colors = {};
  document.querySelectorAll('[data-color]').forEach((i) => (colors[i.dataset.color] = i.value));
  const fields = [...document.querySelectorAll('#fields .field-row')].map((r) => ({
    key: r.querySelector('.fk').value.trim(),
    label: r.querySelector('.fl').value.trim(),
    type: r.querySelector('.ft').value,
    required: r.querySelector('.fr').value === 'true',
    help: r.querySelector('.fh').value.trim(),
  })).filter((f) => f.key && f.label);
  const patch = {
    name: $('e-name').value.trim(), enabled: $('e-enabled').value === 'true',
    productName: $('e-productName').value.trim(), tagline: $('e-tagline').value.trim(),
    intro: $('e-intro').value, successMessage: $('e-successMessage').value,
    logoUrl: $('e-logoUrl').value.trim(), colors, fields,
    orgQuery: $('e-orgQuery').value.trim(), orgField: $('e-orgField').value.trim(), roles: $('e-roles').value.trim(),
  };
  try {
    editing = await api('PUT', `/api/admin/forms/${encodeURIComponent(editing.id)}`, patch);
    await loadForms();
    msg($('e-msg'), 'Saved.', 'ok');
  } catch (e) { msg($('e-msg'), e.message, 'err'); }
});
$('e-delete').addEventListener('click', async () => {
  if (!confirm(`Delete form "${editing.name}"? This cannot be undone.`)) return;
  try {
    await api('DELETE', `/api/admin/forms/${encodeURIComponent(editing.id)}`);
    $('editor').classList.add('hidden'); editing = null;
    await loadForms();
  } catch (e) { msg($('e-msg'), e.message, 'err'); }
});

// ---- Init ----
(async function init() {
  try { await loadConnection(); await loadForms(); }
  catch (e) { msg($('c-msg'), 'Load failed: ' + e.message, 'err'); }
})();
