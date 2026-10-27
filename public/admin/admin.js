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
  $('c-userSearchFields').value = c.userSearchFields || '';
}
$('c-save').addEventListener('click', async () => {
  try {
    const body = {
      url: $('c-url').value, apiPath: $('c-apiPath').value, username: $('c-username').value,
      requestor: $('c-requestor').value, orgField: $('c-orgField').value, orgQuery: $('c-orgQuery').value,
      userSearchFields: $('c-userSearchFields').value,
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
    <select class="ft">${['text', 'email', 'tel', 'number', 'userLookup'].map((t) => `<option ${f.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
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
  $('e-scopeManagerToOrg').value = String(editing.scopeManagerToOrg === true);
  $('e-roles').value = editing.roles || '';
  $('e-requestParams').value = editing.requestParams || '';
  colorInputs(editing.colors || {});
  $('fields').innerHTML = '';
  (editing.fields || []).forEach((f) => $('fields').appendChild(fieldRow(f)));
  // Reset the API-call preview for the newly opened form.
  $('e-preview-out').classList.add('hidden');
  $('e-preview-out').textContent = '';
  $('e-preview-curl').classList.add('hidden');
  $('e-preview-postman').classList.add('hidden');
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
    orgQuery: $('e-orgQuery').value.trim(), orgField: $('e-orgField').value.trim(),
    scopeManagerToOrg: $('e-scopeManagerToOrg').value === 'true', roles: $('e-roles').value.trim(),
    requestParams: $('e-requestParams').value,
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

// ---- API call preview ----
let previewData = null;
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); msg($('e-msg'), okMsg, 'ok'); }
  catch { msg($('e-msg'), 'Copy failed — select the text and copy manually.', 'err'); }
}
$('e-preview').addEventListener('click', async () => {
  if (!editing) return;
  try {
    const p = await api('GET', `/api/admin/forms/${encodeURIComponent(editing.id)}/preview`);
    previewData = p;
    $('e-preview-out').textContent =
      `# ${p.method} ${p.endpoint}  (${p.mode} mode · ${p.contentType})\n` +
      `# URL:  ${p.url}\n` +
      `# Auth: ${p.auth}\n\n` +
      `${p.curl}\n\n# ${p.note}`;
    $('e-preview-out').classList.remove('hidden');
    $('e-preview-curl').classList.remove('hidden');
    $('e-preview-postman').classList.remove('hidden');
  } catch (e) { msg($('e-msg'), e.message, 'err'); }
});
$('e-preview-curl').addEventListener('click', () => previewData && copyText(previewData.curl, 'cURL copied.'));
$('e-preview-postman').addEventListener('click', () => previewData && copyText(previewData.postman, 'Postman body copied.'));

// ---- Admin password ----
$('p-save').addEventListener('click', async () => {
  const current = $('p-current').value;
  const next = $('p-new').value;
  const confirmPw = $('p-confirm').value;
  if (next.length < 8) return msg($('p-msg'), 'New password must be at least 8 characters.', 'err');
  if (next !== confirmPw) return msg($('p-msg'), 'New passwords do not match.', 'err');
  try {
    await api('POST', '/api/admin/password', { current, next });
    $('p-current').value = $('p-new').value = $('p-confirm').value = '';
    msg($('p-msg'), 'Password changed. Use the new password next time you log in.', 'ok');
  } catch (e) { msg($('p-msg'), e.message, 'err'); }
});

// ---- Recent activity ----
// Events share a reqId per user action, so we group them into one collapsible
// row (with a colour-coded status) instead of a flat, overflowing list.
let logTimer = null;
let lastEvents = [];
let logFilter = 'all';
const expanded = new Set();        // reqIds the user has opened
const LVL = { error: 0, warn: 1, info: 2, debug: 3 };

function fmtVal(v, max = 80) {
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function groupStatus(events) {
  const err = events.some((e) => e.level === 'error'
    || (e.event === 'saviynt.call' && (Number(e.status) >= 400 || (e.errorCode !== undefined && String(e.errorCode) !== '0'))));
  if (err) return 'err';
  if (events.some((e) => e.level === 'warn')) return 'warn';
  const ok = events.some((e) => e.event === 'form.submit_ok'
    || (e.event === 'users.lookup' && Number(e.matched) > 0));
  return ok ? 'ok' : 'info';
}

function summarize(events) {
  const by = (name) => events.find((e) => e.event === name);
  const status = groupStatus(events);
  const sub = by('form.submit');
  const subFail = by('form.submit_failed');
  const subOk = by('form.submit_ok');
  const lookup = by('users.lookup') || by('users.lookup_failed');

  if (sub || subFail || subOk) {
    const who = sub ? `${sub.username || '—'}${sub.organization ? ' → ' + sub.organization : ''}` : '';
    if (subFail) return { status, kind: 'submit', title: 'Submission failed', meta: [who, subFail.error].filter(Boolean).join(' · ') };
    if (subOk) return { status, kind: 'submit', title: 'Submission sent', meta: [who, subOk.requestId ? 'request ' + subOk.requestId : ''].filter(Boolean).join(' · ') };
    return { status, kind: 'submit', title: 'Submission', meta: who };
  }
  if (lookup) {
    const q = lookup.q ? `"${lookup.q}"` : '';
    const m = lookup.event === 'users.lookup_failed' ? 'failed'
      : (lookup.matched !== undefined ? `${lookup.matched} ${Number(lookup.matched) === 1 ? 'match' : 'matches'}` : '');
    return { status, kind: 'lookup', title: 'Manager lookup', meta: [q, m].filter(Boolean).join(' · ') };
  }
  // admin / startup / other: summarise the first non-Saviynt event.
  const head = events.find((e) => !e.event.startsWith('saviynt.')) || events[0];
  const { ts, level, event, reqId, ...rest } = head;
  return {
    status, kind: event.startsWith('admin.') ? 'admin' : 'other', title: event,
    meta: Object.entries(rest).map(([k, v]) => `${k}=${fmtVal(v)}`).join(' · '),
  };
}

function stepHtml(e) {
  const { ts, level, event, reqId, body, ...rest } = e;
  const t = new Date(ts).toLocaleTimeString();
  const kv = Object.entries(rest).map(([k, v]) => `${esc(k)}=${esc(fmtVal(v, 140))}`).join('  ');
  let bodyHtml = '';
  if (body !== undefined) {
    const pretty = JSON.stringify(body, null, 2);
    bodyHtml = `<div class="json-box"><button class="small copy" data-copy="${esc(pretty)}">Copy</button>${esc(pretty)}</div>`;
  }
  return `<div class="log-step"><span class="lv ${esc(level)}">${esc(level)}</span><span class="muted">${esc(t)}</span> <code>${esc(event)}</code> <span class="muted">${kv}</span>${bodyHtml}</div>`;
}

function renderLogs() {
  const groups = new Map();
  for (const e of lastEvents) {
    const key = e.reqId || `_${e.ts}_${e.event}`; // events without a reqId each stand alone
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const list = [...groups.entries()]
    .map(([key, evs]) => ({ key, evs, newest: evs[0].ts, ...summarize(evs) }))
    .sort((a, b) => (a.newest < b.newest ? 1 : -1))
    .filter((g) => logFilter === 'all'
      || (logFilter === 'problems' && (g.status === 'err' || g.status === 'warn'))
      || (logFilter === 'submits' && g.kind === 'submit')
      || (logFilter === 'lookups' && g.kind === 'lookup'));

  if (!list.length) return '<p class="muted" style="padding:6px 2px">No matching events.</p>';
  return list.map((g) => {
    const open = expanded.has(g.key);
    const t = new Date(g.newest).toLocaleTimeString();
    const steps = open ? `<div class="log-steps">${[...g.evs].reverse().map(stepHtml).join('')}</div>` : '';
    return `<div class="log-group">
      <div class="log-sum" data-toggle="${esc(g.key)}">
        <span class="dot ${g.status}"></span>
        <span class="time">${esc(t)}</span>
        <span class="title">${esc(g.title)}</span>
        <span class="meta">${esc(g.meta)}</span>
        <span class="caret">${open ? '▾' : '▸'}</span>
      </div>${steps}</div>`;
  }).join('');
}

async function loadLogs() {
  const box = $('log-list');
  const prevScroll = box.scrollTop;
  try {
    const { level, events } = await api('GET', '/api/admin/logs?limit=200');
    $('log-level').textContent = level;
    lastEvents = events;
    box.innerHTML = renderLogs();
    box.scrollTop = prevScroll;
  } catch (e) { box.innerHTML = `<p class="muted">Could not load logs: ${esc(e.message)}</p>`; }
}

async function copyLog(text, btn) {
  const orig = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
  catch { btn.textContent = 'Copy failed'; }
  setTimeout(() => { btn.textContent = orig; }, 1200);
}

$('log-list').addEventListener('click', (ev) => {
  const copy = ev.target.closest('[data-copy]');
  if (copy) { ev.stopPropagation(); copyLog(copy.getAttribute('data-copy'), copy); return; }
  const sum = ev.target.closest('[data-toggle]');
  if (!sum) return;
  const key = sum.getAttribute('data-toggle');
  if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
  const box = $('log-list'); const s = box.scrollTop;
  box.innerHTML = renderLogs(); box.scrollTop = s;
});
$('log-filter').addEventListener('change', (e) => { logFilter = e.target.value; $('log-list').innerHTML = renderLogs(); });
$('log-refresh').addEventListener('click', loadLogs);
$('log-auto').addEventListener('change', (e) => { clearInterval(logTimer); if (e.target.checked) logTimer = setInterval(loadLogs, 5000); });

// ---- Init ----
(async function init() {
  try { await loadConnection(); await loadForms(); await loadLogs(); }
  catch (e) { msg($('c-msg'), 'Load failed: ' + e.message, 'err'); }
})();
