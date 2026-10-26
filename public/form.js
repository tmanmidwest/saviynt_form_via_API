// Public create-user request wizard for one form. The form id is the last
// path segment of /f/<id>. Talks only to this app's backend.

const $ = (id) => document.getElementById(id);
const FORM_ID = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
let form = null;
let orgs = [];
const data = {};
const displays = {}; // field key -> label shown in review (for lookups)

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function banner(text, kind) {
  const el = $('banner');
  el.textContent = text || '';
  el.className = 'banner' + (text ? ' ' + kind : '');
}
function showStep(n) {
  banner('');
  ['step-0', 'step-1', 'step-2', 'step-done'].forEach((id) => $(id).classList.add('hidden'));
  $({ 0: 'step-0', 1: 'step-1', 2: 'step-2', done: 'step-done' }[n]).classList.remove('hidden');
  document.querySelectorAll('.steps div').forEach((d, i) => d.classList.toggle('active', typeof n === 'number' && i <= n));
  window.scrollTo(0, 0);
}

function applyForm() {
  document.title = form.productName || 'Access Request';
  $('product').textContent = form.productName || 'Access Request';
  $('tagline').textContent = form.tagline || '';
  $('intro').textContent = form.intro || '';
  $('success-msg').textContent = form.successMessage || 'Request submitted.';
  if (form.logoUrl) { $('logo').src = form.logoUrl; $('logo').classList.remove('hidden'); }
  const c = form.colors || {};
  const root = document.documentElement.style;
  const vars = { primary: '--primary', primaryText: '--primary-text', accent: '--accent', background: '--bg', surface: '--surface', text: '--text', muted: '--muted' };
  for (const [k, v] of Object.entries(vars)) if (c[k]) root.setProperty(v, c[k]);

  $('fields').innerHTML = (form.fields || []).map((f) => {
    const req = f.required ? ' *' : '';
    const help = f.help ? `<div class="help">${esc(f.help)}</div>` : '';
    const label = `<label for="f-${esc(f.key)}">${esc(f.label)}${req}</label>${help}`;
    if (f.type === 'userLookup') {
      return label +
        `<div class="lookup"><input id="f-${esc(f.key)}" type="text" autocomplete="off" placeholder="Start typing a name…">` +
        `<div class="results" id="r-${esc(f.key)}"></div></div>`;
    }
    return label + `<input id="f-${esc(f.key)}" type="${esc(f.type || 'text')}" data-key="${esc(f.key)}">`;
  }).join('');

  // Wire up any user-lookup fields.
  (form.fields || []).filter((f) => f.type === 'userLookup').forEach(wireLookup);
}

function wireLookup(f) {
  const input = $(`f-${f.key}`);
  const results = $(`r-${f.key}`);
  let timer = null;

  function close() { results.style.display = 'none'; results.innerHTML = ''; }
  function note(text) { results.innerHTML = `<div class="result note">${esc(text)}</div>`; results.style.display = 'block'; }

  async function search() {
    const q = input.value.trim();
    // Selecting then editing clears the stored choice.
    if (data[f.key] && q !== displays[f.key]) { delete data[f.key]; delete displays[f.key]; }
    if (q.length < 2) { close(); return; }
    note('Searching…');
    const params = new URLSearchParams({ q });
    if (data.organization) params.set('org', data.organization);
    try {
      const res = await fetch(`/api/forms/${encodeURIComponent(FORM_ID)}/users?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) { note(`Lookup failed: ${body.error || res.status}`); return; }
      const users = body.users || [];
      if (!users.length) { note('No matching users found.'); return; }
      results.innerHTML = users.map((u, i) => {
        const sub = [u.title, u.email].filter(Boolean).join(' · ');
        return `<div class="result" data-i="${i}"><strong>${esc(u.name)}</strong>${sub ? `<br><span class="sub">${esc(sub)}</span>` : ''}</div>`;
      }).join('');
      results.style.display = 'block';
      results.querySelectorAll('.result').forEach((el) => el.addEventListener('click', () => {
        const u = users[el.dataset.i];
        data[f.key] = u.username;           // submit the username
        displays[f.key] = `${u.name}${u.email ? ` (${u.email})` : ''}`;
        input.value = displays[f.key];
        close();
      }));
    } catch (err) { note(`Lookup failed: ${err.message}`); }
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
  input.addEventListener('blur', () => setTimeout(close, 200));
}

async function loadOrgs() {
  if (form.mode === 'mock') banner('Mock mode — organizations and requests are simulated.', 'info');
  const res = await fetch(`/api/forms/${encodeURIComponent(FORM_ID)}/organizations`);
  const body = await res.json();
  if (!res.ok) { banner(`Could not load organizations: ${body.error}`, 'error'); return; }
  orgs = body.organizations;
  $('org').innerHTML = '<option value="">Choose an organization</option>' +
    orgs.map((o, i) => `<option value="${i}">${esc(o.name)}</option>`).join('');
  $('org').disabled = false;
}

function reviewList() {
  const rows = [['Organization', data.organization]];
  for (const f of form.fields || []) {
    if (data[f.key]) rows.push([f.label, displays[f.key] || data[f.key]]);
  }
  $('review').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}
function validateFields() {
  for (const f of form.fields || []) {
    if (f.type === 'userLookup') {
      // Value comes from a picked result, not the raw text.
      if (f.required && !data[f.key]) { banner(`Please choose a ${f.label.toLowerCase()} from the list.`, 'error'); return false; }
      continue;
    }
    const val = $(`f-${f.key}`).value.trim();
    if (f.required && !val) { banner(`${f.label} is required.`, 'error'); return false; }
    data[f.key] = val;
  }
  return true;
}

$('org').addEventListener('change', () => {
  const o = orgs[$('org').value];
  $('org-detail').textContent = o ? [o.description, o.location, o.parent && `Parent: ${o.parent}`].filter(Boolean).join(' · ') : '';
  $('to-1').disabled = !o;
  if (o) data.organization = o.name;
});
$('to-1').addEventListener('click', () => showStep(1));
$('back-0').addEventListener('click', () => showStep(0));
$('to-2').addEventListener('click', () => { if (validateFields()) { reviewList(); showStep(2); } });
$('back-1').addEventListener('click', () => showStep(1));
$('again').addEventListener('click', () => {
  Object.keys(data).forEach((k) => delete data[k]);
  Object.keys(displays).forEach((k) => delete displays[k]);
  $('org').value = ''; $('org-detail').textContent = ''; $('to-1').disabled = true;
  document.querySelectorAll('#fields input').forEach((i) => (i.value = ''));
  showStep(0);
});
$('submit').addEventListener('click', async () => {
  const btn = $('submit');
  btn.disabled = true; btn.textContent = 'Submitting…'; banner('');
  try {
    const res = await fetch(`/api/forms/${encodeURIComponent(FORM_ID)}/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Request failed.');
    if (body.requestId) {
      $('reqid').textContent = body.requestId;
      $('reqid-wrap').classList.remove('hidden');
      $('status-link').href = `/status.html?form=${encodeURIComponent(FORM_ID)}&requestId=${encodeURIComponent(body.requestId)}`;
    } else {
      $('status-link').classList.add('hidden');
    }
    showStep('done');
  } catch (err) {
    banner(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Submit request';
  }
});

(async function init() {
  const res = await fetch(`/api/forms/${encodeURIComponent(FORM_ID)}`);
  if (!res.ok) { banner('This form was not found or is not published.', 'error'); return; }
  form = await res.json();
  applyForm();
  await loadOrgs();
})().catch((err) => banner(`Startup failed: ${err.message}`, 'error'));
