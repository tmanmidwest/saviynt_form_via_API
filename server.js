require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const store = require('./lib/store');
const log = require('./lib/log');
const { clientFor, mockMode } = require('./lib/clients');

const app = express();
app.use(express.json());

// Give each request a short id that ties its log lines together.
app.use((req, res, next) => {
  req.reqId = crypto.randomBytes(4).toString('hex');
  next();
});

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
    log.warn('admin.auth_failed', { reqId: req.reqId, user, ip: req.ip });
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

// Build the Saviynt user-search query from the connection template.
function userQuery(conn, text, org) {
  const tpl = conn.userSearchQuery || 'username:{q}*';
  return tpl.replace(/\{q\}/g, text || '*').replace(/\{org\}/g, org || '');
}

// Normalize a user record from the search (live keys are inconsistent) to the
// few fields the picker needs.
function normalizeUser(u) {
  const username = u.username || u['User Name'] || u.systemusername || '';
  const first = u.firstname || '';
  const last = u.lastname || u['Last Name'] || '';
  const name = [first, last].filter(Boolean).join(' ').trim() || u.displayname || username;
  return { username, name, email: u.email || '', title: u.title || '', customer: u.customer || '' };
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
  for (const k of ['url', 'apiPath', 'username', 'requestor', 'orgField', 'orgQuery', 'userSearchQuery']) {
    if (b[k] !== undefined) patch[k] = String(b[k]).trim();
  }
  // Only overwrite the password when a new one is provided.
  if (b.password) patch.password = String(b.password);
  const c = store.setConnection(patch);
  // Log which settings changed, never the values of secret ones.
  log.info('admin.connection_updated', { reqId: req.reqId, changed: Object.keys(patch).concat(b.password ? ['password'] : []) });
  res.json({ ...c, password: '', hasPassword: Boolean(c.password) });
});

app.post('/api/admin/connection/test', requireAdmin, async (req, res) => {
  try {
    await clientFor(store.getConnection()).ping();
    log.info('admin.connection_test', { reqId: req.reqId, result: 'ok' });
    res.json({ ok: true, mode: mockMode ? 'mock' : 'live' });
  } catch (err) {
    log.warn('admin.connection_test', { reqId: req.reqId, result: 'failed', error: err.message });
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Recent events for the admin "Recent activity" view.
app.get('/api/admin/logs', requireAdmin, (req, res) => {
  res.json({ level: log.LEVEL_NAME, events: log.recent(Number(req.query.limit) || 200) });
});

app.get('/api/admin/forms', requireAdmin, (req, res) => res.json({ forms: store.listForms() }));

app.post('/api/admin/forms', requireAdmin, (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'A form name is required.' });
  const form = store.createForm({ name });
  log.info('admin.form_created', { reqId: req.reqId, formId: form.id, name });
  res.status(201).json(form);
});

app.get('/api/admin/forms/:id', requireAdmin, (req, res) => {
  const form = store.getForm(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form not found.' });
  res.json(form);
});

app.put('/api/admin/forms/:id', requireAdmin, (req, res) => {
  const updated = store.updateForm(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Form not found.' });
  log.info('admin.form_updated', { reqId: req.reqId, formId: updated.id, changed: Object.keys(req.body || {}) });
  res.json(updated);
});

app.delete('/api/admin/forms/:id', requireAdmin, (req, res) => {
  const ok = store.deleteForm(req.params.id);
  log.info('admin.form_deleted', { reqId: req.reqId, formId: req.params.id, ok });
  res.json({ ok });
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
    const orgs = await clientFor(conn).getOrganizations({ orgQuery: orgQuery || undefined, reqId: req.reqId });
    const result = orgs
      .filter((o) => !o.status || String(o.status).toLowerCase() === 'active')
      .map((o) => ({ name: o.organizationname, description: o.description || '', parent: o.parentorganization || '', location: o.location || '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ organizations: result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Manager / user lookup for userLookup fields. Searches Saviynt with the
// service account and refines matches here so it's resilient to query syntax.
app.get('/api/forms/:id/users', async (req, res) => {
  const form = store.getForm(req.params.id);
  if (!form || !form.enabled) return res.status(404).json({ error: 'Form not found.' });
  const text = String(req.query.q || '').trim();
  const org = String(req.query.org || '').trim();
  if (text.length < 2 && !(form.scopeManagerToOrg && org)) return res.json({ users: [] });
  const { conn } = settingsFor(form);
  try {
    const query = userQuery(conn, text, form.scopeManagerToOrg ? org : '');
    const raw = await clientFor(conn).searchUsers(query, { max: 50, reqId: req.reqId });
    const needle = text.toLowerCase();
    const users = raw
      .map(normalizeUser)
      .filter((u) => u.username)
      // Refine by typed text across the visible fields.
      .filter((u) => !needle || [u.name, u.username, u.email, u.title].some((v) => v.toLowerCase().includes(needle)))
      // If scoped to an org, keep only that org's members (mock tags this).
      .filter((u) => !(form.scopeManagerToOrg && org) || !u.customer || u.customer === org)
      .slice(0, 10);
    res.json({ users });
  } catch (err) {
    log.warn('users.lookup_failed', { reqId: req.reqId, formId: form.id, error: err.message });
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

  log.info('form.submit', { reqId: req.reqId, formId: form.id, organization, username: user.username, manager: user.manager || null });
  try {
    const result = await clientFor(conn).createUserRequest(user, { reqId: req.reqId });
    const requestId = result.requestid || result.requestId || null;
    log.info('form.submit_ok', { reqId: req.reqId, formId: form.id, requestId });
    res.json({ ok: true, requestId, message: result.msg || 'Request submitted.' });
  } catch (err) {
    log.error('form.submit_failed', { reqId: req.reqId, formId: form.id, error: err.message });
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
    const data = await clientFor(conn).fetchRequestHistory({ username, requestid: requestId, max: '1' }, { reqId: req.reqId });
    const r = (data.requests || [])[0];
    if (!r) return res.status(404).json({ error: `No request found with ID ${requestId}.` });
    res.json({
      requestId: r.requestid, type: r.requesttype, requestedFor: r.requestedfor,
      submittedOn: r.requestsubmittedon, status: r.status ? r.status.trim() : '',
      assignee: r.assignee || '', detail: r.requestandtaskstatus || '',
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---- Public pages ---------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));
// Pretty URL for a form: /f/<id> serves the form shell.
app.get('/f/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'form.html')));

store.initIfMissing();
const port = Number(process.env.PORT) || 3000;
app.listen(port, async () => {
  const conn = store.getConnection();
  log.info('startup', {
    port, mode: mockMode ? 'mock' : 'live', logLevel: log.LEVEL_NAME,
    saviyntUrl: conn.url || null, saviyntConfigured: Boolean(conn.url && conn.username),
    forms: store.listForms().length,
  });
  // Verify the service account can authenticate (don't crash if it can't).
  if (!mockMode && conn.url && conn.username) {
    try {
      await clientFor(conn).ping();
      log.info('startup.saviynt_auth', { result: 'ok' });
    } catch (err) {
      log.warn('startup.saviynt_auth', { result: 'failed', error: err.message });
    }
  }
  console.log(`Saviynt Forms on http://localhost:${port}/  · admin: /admin (user ${ADMIN_USER}) · ${mockMode ? 'mock' : 'live'} mode`);
});
