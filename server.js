require('dotenv').config();
const path = require('path');
const express = require('express');
const store = require('./lib/store');
const { clientFor, mockMode } = require('./lib/clients');

const app = express();
app.use(express.json());

// Liveness probe for orchestrators/deployers. No auth, no secrets.
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---- Admin auth (HTTP Basic) ---------------------------------------------
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = 'admin';
  console.warn('WARNING: ADMIN_PASSWORD is not set; using "admin". Set it in your .env for anything but local testing.');
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (user === ADMIN_USER && pass === ADMIN_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Saviynt Forms Admin"');
  res.status(401).json({ error: 'Admin authentication required.' });
}

// Resolve the effective connection settings for a form.
function settingsFor(form) {
  const conn = store.getConnection();
  return {
    conn,
    orgField: (form.orgField || conn.orgField || 'customer'),
    orgQuery: (form.orgQuery || conn.orgQuery || ''),
  };
}

// Strip secrets / admin-only fields before sending a form to the public page.
function publicForm(form) {
  const { orgField, orgQuery, roles, ...rest } = form;
  return rest;
}

// ---- Admin API ------------------------------------------------------------
app.get('/api/admin/connection', requireAdmin, (req, res) => {
  const c = store.getConnection();
  // Never echo the stored password back; just whether one is set.
  res.json({ ...c, password: '', hasPassword: Boolean(c.password) });
});

app.put('/api/admin/connection', requireAdmin, (req, res) => {
  const b = req.body || {};
  const patch = {};
  for (const k of ['url', 'apiPath', 'username', 'requestor', 'orgField', 'orgQuery']) {
    if (b[k] !== undefined) patch[k] = String(b[k]).trim();
  }
  // Only overwrite the password when a new one is provided.
  if (b.password) patch.password = String(b.password);
  const c = store.setConnection(patch);
  res.json({ ...c, password: '', hasPassword: Boolean(c.password) });
});

app.post('/api/admin/connection/test', requireAdmin, async (req, res) => {
  try {
    await clientFor(store.getConnection()).ping();
    res.json({ ok: true, mode: mockMode ? 'mock' : 'live' });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/forms', requireAdmin, (req, res) => res.json({ forms: store.listForms() }));

app.post('/api/admin/forms', requireAdmin, (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'A form name is required.' });
  res.status(201).json(store.createForm({ name }));
});

app.get('/api/admin/forms/:id', requireAdmin, (req, res) => {
  const form = store.getForm(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form not found.' });
  res.json(form);
});

app.put('/api/admin/forms/:id', requireAdmin, (req, res) => {
  const updated = store.updateForm(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Form not found.' });
  res.json(updated);
});

app.delete('/api/admin/forms/:id', requireAdmin, (req, res) => {
  res.json({ ok: store.deleteForm(req.params.id) });
});

// Serve the admin console behind the same basic auth.
app.use('/admin', requireAdmin, express.static(path.join(__dirname, 'public', 'admin')));

// ---- Public API -----------------------------------------------------------
// Only enabled forms are listed publicly.
app.get('/api/forms', (req, res) => {
  res.json({ forms: store.listForms().filter((f) => f.enabled).map((f) => ({ id: f.id, name: f.name, productName: f.productName, tagline: f.tagline })) });
});

app.get('/api/forms/:id', (req, res) => {
  const form = store.getForm(req.params.id);
  if (!form || !form.enabled) return res.status(404).json({ error: 'Form not found.' });
  res.json({ ...publicForm(form), mode: mockMode ? 'mock' : 'live' });
});

app.get('/api/forms/:id/organizations', async (req, res) => {
  const form = store.getForm(req.params.id);
  if (!form || !form.enabled) return res.status(404).json({ error: 'Form not found.' });
  const { conn, orgQuery } = settingsFor(form);
  try {
    const orgs = await clientFor(conn).getOrganizations({ orgQuery: orgQuery || undefined });
    const result = orgs
      .filter((o) => !o.status || String(o.status).toLowerCase() === 'active')
      .map((o) => ({ name: o.organizationname, description: o.description || '', parent: o.parentorganization || '', location: o.location || '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ organizations: result });
  } catch (err) {
    console.error('getOrganization failed:', err.message, err.saviynt || '');
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/forms/:id/request', async (req, res) => {
  const form = store.getForm(req.params.id);
  if (!form || !form.enabled) return res.status(404).json({ error: 'Form not found.' });
  const { conn, orgField } = settingsFor(form);
  const body = req.body || {};

  const organization = String(body.organization || '').trim();
  if (!organization) return res.status(400).json({ error: 'Please choose an organization.' });

  const user = {};
  for (const field of form.fields || []) {
    const value = String(body[field.key] ?? '').trim();
    if (field.required && !value) return res.status(400).json({ error: `${field.label} is required.` });
    if (value) user[field.key] = value;
  }
  if (!user.username && user.firstname && user.lastname) {
    user.username = `${user.firstname}.${user.lastname}`.toLowerCase().replace(/[^a-z0-9.]/g, '');
  }
  // Native Saviynt organization attribute (usually "customer").
  user[orgField] = organization;
  if (form.roles) user.Roles = form.roles;
  if (conn.requestor) user.requestor = conn.requestor;

  try {
    const result = await clientFor(conn).createUserRequest(user);
    res.json({ ok: true, requestId: result.requestid || result.requestId || null, message: result.msg || 'Request submitted.' });
  } catch (err) {
    console.error('createUserRequest failed:', err.message, err.saviynt || '');
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/forms/:id/request-status', async (req, res) => {
  const form = store.getForm(req.params.id);
  if (!form || !form.enabled) return res.status(404).json({ error: 'Form not found.' });
  const requestId = String(req.query.requestId || '').trim();
  if (!requestId) return res.status(400).json({ error: 'requestId is required.' });
  const { conn } = settingsFor(form);
  const username = conn.requestor || conn.username || 'admin';
  try {
    const data = await clientFor(conn).fetchRequestHistory({ username, requestid: requestId, max: '1' });
    const r = (data.requests || [])[0];
    if (!r) return res.status(404).json({ error: `No request found with ID ${requestId}.` });
    res.json({
      requestId: r.requestid, type: r.requesttype, requestedFor: r.requestedfor,
      submittedOn: r.requestsubmittedon, status: r.status ? r.status.trim() : '',
      assignee: r.assignee || '', detail: r.requestandtaskstatus || '',
    });
  } catch (err) {
    console.error('fetchRequestHistory failed:', err.message, err.saviynt || '');
    res.status(502).json({ error: err.message });
  }
});

// ---- Public pages ---------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));
// Pretty URL for a form: /f/<id> serves the form shell.
app.get('/f/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'form.html')));

store.initIfMissing();
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Saviynt Forms running on http://localhost:${port} (${mockMode ? 'mock' : 'live'} mode)`);
  console.log(`Admin console: http://localhost:${port}/admin  (user: ${ADMIN_USER})`);
});
