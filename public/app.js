// Branded create-user request wizard. Talks only to the local backend.

const $ = (id) => document.getElementById(id);
let brand = null;
let orgs = [];
const data = {}; // collected field values

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
  const map = { 0: 'step-0', 1: 'step-1', 2: 'step-2', done: 'step-done' };
  $(map[n]).classList.remove('hidden');
  document.querySelectorAll('.steps div').forEach((d, i) => {
    d.classList.toggle('active', typeof n === 'number' && i <= n);
  });
  window.scrollTo(0, 0);
}

function applyBrand() {
  document.title = brand.productName || 'Access Request';
  $('product').textContent = brand.productName || 'Access Request';
  $('tagline').textContent = brand.tagline || '';
  $('intro').textContent = brand.intro || '';
  $('success-msg').textContent = brand.successMessage || 'Request submitted.';
  if (brand.logoUrl) {
    $('logo').src = brand.logoUrl;
    $('logo').classList.remove('hidden');
  }
  const c = brand.colors || {};
  const root = document.documentElement.style;
  const vars = { primary: '--primary', primaryText: '--primary-text', accent: '--accent', background: '--bg', surface: '--surface', text: '--text', muted: '--muted' };
  for (const [k, v] of Object.entries(vars)) if (c[k]) root.setProperty(v, c[k]);

  // Build the user-detail fields from the brand config.
  const wrap = $('fields');
  wrap.innerHTML = Object.entries(brand.fields || {}).map(([key, cfg]) => {
    const req = cfg.required ? ' *' : '';
    const help = cfg.help ? `<div class="help">${esc(cfg.help)}</div>` : '';
    return `<label for="f-${key}">${esc(cfg.label)}${req}</label>${help}` +
      `<input id="f-${key}" type="${esc(cfg.type || 'text')}" data-key="${esc(key)}">`;
  }).join('');
}

async function loadOrgs() {
  const health = await fetch('/api/health').then((r) => r.json()).catch(() => ({ ok: false }));
  if (health.mode === 'mock') banner('Running in mock mode — organizations and requests are simulated.', 'info');
  const res = await fetch('/api/organizations');
  const body = await res.json();
  if (!res.ok) {
    banner(`Could not load organizations: ${body.error}`, 'error');
    return;
  }
  orgs = body.organizations;
  $('org').innerHTML = '<option value="">Choose an organization</option>' +
    orgs.map((o, i) => `<option value="${i}">${esc(o.name)}</option>`).join('');
  $('org').disabled = false;
}

function reviewList() {
  const rows = [['Organization', data.organization]];
  for (const [key, cfg] of Object.entries(brand.fields || {})) {
    if (data[key]) rows.push([cfg.label, data[key]]);
  }
  $('review').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

function validateFields() {
  for (const [key, cfg] of Object.entries(brand.fields || {})) {
    const val = $(`f-${key}`).value.trim();
    if (cfg.required && !val) {
      banner(`${cfg.label} is required.`, 'error');
      return false;
    }
    data[key] = val;
  }
  return true;
}

// Wiring
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
  $('org').value = '';
  $('org-detail').textContent = '';
  $('to-1').disabled = true;
  document.querySelectorAll('#fields input').forEach((i) => (i.value = ''));
  showStep(0);
});

$('submit').addEventListener('click', async () => {
  const btn = $('submit');
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  banner('');
  try {
    const res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Request failed.');
    if (body.requestId) {
      $('reqid').textContent = body.requestId;
      $('reqid-wrap').classList.remove('hidden');
      $('status-link').href = 'status.html?requestId=' + encodeURIComponent(body.requestId);
    }
    showStep('done');
  } catch (err) {
    banner(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit request';
  }
});

(async function init() {
  brand = await fetch('/api/brand').then((r) => r.json());
  applyBrand();
  await loadOrgs();
})().catch((err) => banner(`Startup failed: ${err.message}`, 'error'));
