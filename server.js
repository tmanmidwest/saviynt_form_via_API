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

// Password hashing for the admin login (scrypt). Format: scrypt$<salt>$<hash>.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyHash(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
// Constant-time string compare for the env-password fallback.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// A stored (UI-set) password overrides the env var; the env var is the initial
// password and the fallback until one is set.
function checkAdminPassword(pass) {
  const stored = store.getAdminHash();
  if (stored) return verifyHash(pass, stored);
  return safeEqual(pass, ADMIN_PASSWORD);
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const idx = Buffer.from(encoded, 'base64').toString().indexOf(':');
    const decoded = Buffer.from(encoded, 'base64').toString();
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);
    if (safeEqual(user, ADMIN_USER) && checkAdminPassword(pass)) return next();
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

// Normalize a user record from getUser's userlist to the fields the picker needs.
function normalizeUser(u) {
  const username = u.username || u['User Name'] || u.systemusername || '';
  const first = u.firstname || '';
  const last = u.lastname || u['Last Name'] || '';
  const name = [first, last].filter(Boolean).join(' ').trim() || u.displayname || username;
  return { username, name, email: u.email || '', title: u.title || '', customer: u.customer || '', statuskey: String(u.statuskey ?? '') };
}

// Final shaping shared by the real submit and the admin API preview: username
// fallback, the org attribute, roles and requestor. Keeping both on one function
// means the preview can't drift from what's actually sent.
// Parse per-form "extra request parameters" (key=value, one per line) into an
// object. Blank lines and #-comments are ignored. These are tenant-specific
// flags sent with createUserRequest, e.g. dynattrvalidation=true.
function parseRequestParams(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (k) out[k] = t.slice(i + 1).trim();
  }
  return out;
}

function finalizeUserPayload(user, { form, orgField, conn, organization }) {
  if (!user.username && user.firstname && user.lastname) {
    user.username = `${user.firstname}.${user.lastname}`.toLowerCase().replace(/[^a-z0-9.]/g, '');
  }
  user[orgField] = organization;
  if (form.roles) user.Roles = form.roles;
  if (conn.requestor) user.requestor = conn.requestor;
  // Tenant-specific flags (dynattrvalidation, inlineruleevaluation, …); don't
  // override a value a form field already set. Forms saved before this field
  // existed have no requestParams, so fall back to the defaults (but an admin
  // who deliberately cleared it to "" gets none).
  const params = form.requestParams ?? DEFAULT_REQUEST_PARAMS;
  for (const [k, v] of Object.entries(parseRequestParams(params))) {
    if (user[k] === undefined) user[k] = v;
  }
  return user;
}

// The valid sponsors Saviynt will actually accept for an org: its primary
// contact (always), plus org owners who already manage at least one user. The
// tenant's sponsor (manager→owner) attribute only accepts those, so listing
// anyone else produces "owner <x> not found" on submit. Returns resolved
// {username,name,email}.
async function validOrgSponsors(client, org, reqId) {
  if (!org) return [];
  const primary = String(org.primaryvendorcontact || org.primarycontact || org.primaryVendorContact || '').trim();
  const owners = sponsorUsernames(org).filter((u) => u.toLowerCase() !== primary.toLowerCase());
  const candidates = [];
  if (primary) candidates.push({ un: primary, always: true });
  for (const o of owners) candidates.push({ un: o, always: false });

  const out = [];
  const seen = new Set();
  for (const c of candidates) {
    const key = c.un.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let ok = c.always;
    if (!ok) {
      // Valid iff they manage at least one user.
      try { ok = (await client.searchUsers({ manager: c.un }, { max: 1, reqId })).length > 0; } catch { ok = false; }
    }
    if (!ok) continue;
    let resolved = { username: c.un, name: c.un, email: '' };
    try {
      const u = (await client.searchUsers({ username: c.un }, { max: 1, reqId })).map(normalizeUser).find((x) => x.username.toLowerCase() === key);
      if (u) resolved = { username: u.username, name: u.name, email: u.email };
    } catch { /* keep the bare username */ }
    out.push(resolved);
  }
  return out;
}

const DEFAULT_REQUEST_PARAMS = 'dynattrvalidation=true\ninlineruleevaluation=true\ncheckrules=true';

// Usernames of the candidate sponsors for an org: its primary contact plus any
// organization owners. getOrganization returns primaryvendorcontact (a username
// string) and organizationowners (an array); shapes vary, so be defensive.
function sponsorUsernames(org) {
  if (!org) return [];
  const out = [];
  const pc = org.primaryvendorcontact || org.primarycontact || org.primaryVendorContact;
  if (pc) out.push(String(pc).trim());
  const owners = org.organizationowners || org.organization_owners || org.owners || [];
  for (const o of Array.isArray(owners) ? owners : []) {
    if (!o) continue;
    out.push(String(typeof o === 'string' ? o : (o.username || o.ownername || o.user || o.userName || '')).trim());
  }
  return [...new Set(out.filter(Boolean))];
}

// A representative sample value for a field, used only by the API-call preview.
function sampleValue(field) {
  if (field.type === 'email') return 'jane.doe@example.com';
  if (field.type === 'tel') return '+1-555-0100';
  if (field.type === 'number') return '123';
  if (field.type === 'orgSponsor') return '<sponsor username>';
  if (field.type === 'userLookup') return `<${(field.label || field.key).toLowerCase()} username>`;
  if (field.key === 'firstname') return 'Jane';
  if (field.key === 'lastname') return 'Doe';
  if (field.key === 'username') return 'jane.doe';
  return `<${(field.label || field.key).toLowerCase()}>`;
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
  for (const k of ['url', 'apiPath', 'username', 'requestor', 'orgField', 'orgQuery', 'userSearchFields']) {
    if (b[k] !== undefined) patch[k] = String(b[k]).trim();
  }
  // Only overwrite the password when a new one is provided.
  if (b.password) patch.password = String(b.password);
  const c = store.setConnection(patch);
  // Log which settings changed (keys only, never the secret values).
  log.info('admin.connection_updated', { reqId: req.reqId, changed: Object.keys(patch) });
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

// Change the admin console login password (stored hashed on the volume).
app.post('/api/admin/password', requireAdmin, (req, res) => {
  const current = String((req.body || {}).current || '');
  const next = String((req.body || {}).next || '');
  if (!checkAdminPassword(current)) {
    log.warn('admin.password_change_failed', { reqId: req.reqId, reason: 'wrong current password' });
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  store.setAdminHash(hashPassword(next));
  log.info('admin.password_changed', { reqId: req.reqId });
  res.json({ ok: true });
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

// Preview the exact Saviynt call this form generates, with sample values, so it
// can be compared against Postman / shared with peers when troubleshooting.
// Nothing is sent to Saviynt. Built from finalizeUserPayload so it matches the
// real submit field-for-field.
app.get('/api/admin/forms/:id/preview', requireAdmin, (req, res) => {
  const form = store.getForm(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form not found.' });
  const { conn, orgField } = settingsFor(form);
  const mode = form.submitMode === 'direct' ? 'direct' : 'request';

  // Sample values derived from the form's own fields.
  const user = {};
  for (const field of form.fields || []) {
    const v = sampleValue(field);
    if (v) user[field.key] = v;
  }
  finalizeUserPayload(user, { form, orgField, conn, organization: '<selected organization>' });

  const base = (conn.url || '{{url}}').replace(/\/+$/, '');
  const apiPath = (conn.apiPath || 'api/v5').replace(/^\/+|\/+$/g, '');
  const endpoint = mode === 'direct' ? 'createUser' : 'createUserRequest';
  const url = `${base}/ECM/${apiPath}/${endpoint}`;
  const contentType = mode === 'direct' ? 'application/json' : 'multipart/form-data';

  // cURL, with the bearer token masked.
  const curlLines = [`curl -X POST '${url}' \\`, `  -H 'Authorization: Bearer <access_token>' \\`];
  let postman;
  if (mode === 'direct') {
    curlLines.push(`  -H 'Content-Type: application/json' \\`);
    curlLines.push(`  -d '${JSON.stringify(user, null, 2)}'`);
    postman = JSON.stringify(user, null, 2); // raw JSON body
  } else {
    for (const [k, v] of Object.entries(user)) curlLines.push(`  -F '${k}=${v}' \\`);
    curlLines[curlLines.length - 1] = curlLines[curlLines.length - 1].replace(/ \\$/, '');
    // Postman form-data bulk-edit format: one key:value per line.
    postman = Object.entries(user).map(([k, v]) => `${k}:${v}`).join('\n');
  }

  res.json({
    mode, method: 'POST', endpoint, url, contentType, body: user,
    curl: curlLines.join('\n'),
    postman,
    auth: 'Service-account bearer token from POST /ECM/api/login (refreshed via POST /ECM/oauth/access_token).',
    note: "Values are samples generated from this form's fields; a real submit uses what the requester enters. Save the form first to reflect unsaved edits. No request is sent by this preview.",
  });
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
  const scoped = Boolean(form.scopeManagerToOrg && org);
  if (text.length < 2 && !scoped) return res.json({ users: [] });
  const { conn } = settingsFor(form);
  const client = clientFor(conn);

  // One getUser filtercriteria per configured field (results merged), using a
  // trailing "%" for a prefix match, so typing a name works. When scoped to an
  // org, AND the customer attribute into each query.
  const orgClause = scoped ? { customer: org } : {};
  let filters;
  if (text.length >= 2) {
    const fields = (conn.userSearchFields || 'username,firstname,lastname,email').split(',').map((s) => s.trim()).filter(Boolean);
    filters = fields.map((f) => ({ [f]: `${text}%`, ...orgClause }));
  } else {
    // Scoped browse with no text: list the org's members.
    filters = [orgClause];
  }

  const seen = new Set();
  const merged = [];
  let lastErr = null;
  for (const filter of filters) {
    try {
      const raw = await client.searchUsers(filter, { max: 20, reqId: req.reqId });
      for (const u of raw.map(normalizeUser)) {
        // Only active users (statuskey "1"); keep when status is unknown.
        if (u.statuskey && u.statuskey !== '1') continue;
        const key = u.username.toLowerCase();
        if (u.username && !seen.has(key)) { seen.add(key); merged.push(u); }
      }
    } catch (err) {
      lastErr = err; // a single field query may be rejected; keep the others.
    }
  }
  if (!merged.length && lastErr) {
    log.warn('users.lookup_failed', { reqId: req.reqId, formId: form.id, error: lastErr.message });
    return res.status(502).json({ error: lastErr.message });
  }

  const needle = text.toLowerCase();
  const users = merged
    .filter((u) => !needle || [u.name, u.username, u.email, u.title].some((v) => v.toLowerCase().includes(needle)))
    .filter((u) => !scoped || !u.customer || u.customer === org)
    .map(({ statuskey, ...u }) => u)
    .slice(0, 10);
  // Diagnostic: raw = users returned across queries, matched = after filtering.
  log.info('users.lookup', { reqId: req.reqId, formId: form.id, q: text, queries: filters.length, raw: merged.length, matched: users.length });
  res.json({ users });
});

// Valid sponsors for an org (drives the orgSponsor dropdown): the org's primary
// contact plus its owners, resolved to {username,name,email} via getUser.
app.get('/api/forms/:id/sponsors', async (req, res) => {
  const form = store.getForm(req.params.id);
  if (!form || !form.enabled) return res.status(404).json({ error: 'Form not found.' });
  const org = String(req.query.org || '').trim();
  if (!org) return res.json({ sponsors: [] });
  const { conn, orgQuery } = settingsFor(form);
  try {
    const client = clientFor(conn);
    const orgs = await client.getOrganizations({ orgQuery: orgQuery || undefined, reqId: req.reqId });
    const match = orgs.find((o) => String(o.organizationname || '') === org);
    const sponsors = await validOrgSponsors(client, match, req.reqId);
    log.info('sponsors.list', { reqId: req.reqId, formId: form.id, org, count: sponsors.length });
    res.json({ sponsors });
  } catch (err) {
    log.warn('sponsors.list_failed', { reqId: req.reqId, formId: form.id, org, error: err.message });
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/forms/:id/request', async (req, res) => {
  const form = store.getForm(req.params.id);
  if (!form || !form.enabled) return res.status(404).json({ error: 'Form not found.' });
  const { conn, orgField, orgQuery } = settingsFor(form);
  const body = req.body || {};

  const organization = String(body.organization || '').trim();
  if (!organization) return res.status(400).json({ error: 'Please choose an organization.' });

  const user = {};
  const lookupFields = [];
  const sponsorFields = [];
  for (const field of form.fields || []) {
    const value = String(body[field.key] ?? '').trim();
    if (field.required && !value) return res.status(400).json({ error: `${field.label} is required.` });
    if (value) {
      user[field.key] = value;
      if (field.type === 'userLookup') lookupFields.push(field);
      if (field.type === 'orgSponsor') sponsorFields.push(field);
    }
  }

  // Re-check sponsor picks against the org's valid sponsor list (the browser
  // could submit anything). One getOrganization fetch covers all sponsor fields.
  if (sponsorFields.length) {
    let validSet;
    try {
      const client = clientFor(conn);
      const orgs = await client.getOrganizations({ orgQuery: orgQuery || undefined, reqId: req.reqId });
      const match = orgs.find((o) => String(o.organizationname || '') === organization);
      const valid = await validOrgSponsors(client, match, req.reqId);
      validSet = new Set(valid.map((s) => s.username.toLowerCase()));
    } catch (err) {
      log.warn('form.sponsor_check_failed', { reqId: req.reqId, formId: form.id, error: err.message });
      return res.status(502).json({ error: `Could not verify sponsor: ${err.message}` });
    }
    for (const field of sponsorFields) {
      if (!validSet.has(user[field.key].toLowerCase())) {
        log.warn('form.invalid_sponsor', { reqId: req.reqId, formId: form.id, field: field.key, value: user[field.key], organization });
        return res.status(400).json({ error: `${field.label} "${user[field.key]}" is not a valid sponsor for ${organization}.` });
      }
    }
  }

  // Re-validate user-lookup values server-side: the browser could submit any
  // string. Confirm each picked user exists (and is in the org when scoped).
  for (const field of lookupFields) {
    const username = user[field.key];
    try {
      // Validate by exact username (no % = exact match in getUser).
      const raw = await clientFor(conn).searchUsers({ username }, { max: 10, reqId: req.reqId });
      const match = raw.map(normalizeUser).find((u) => u.username.toLowerCase() === username.toLowerCase());
      const inOrg = !form.scopeManagerToOrg || !match?.customer || match.customer === organization;
      if (!match || !inOrg) {
        log.warn('form.invalid_lookup', { reqId: req.reqId, formId: form.id, field: field.key, value: username });
        return res.status(400).json({ error: `${field.label} "${username}" is not a valid Saviynt user${form.scopeManagerToOrg ? ' for this organization' : ''}.` });
      }
    } catch (err) {
      log.warn('form.lookup_check_failed', { reqId: req.reqId, formId: form.id, field: field.key, error: err.message });
      return res.status(502).json({ error: `Could not verify ${field.label.toLowerCase()}: ${err.message}` });
    }
  }

  // Shape the final payload (username fallback, org attribute, roles, requestor).
  finalizeUserPayload(user, { form, orgField, conn, organization });

  log.info('form.submit', { reqId: req.reqId, formId: form.id, organization, username: user.username, sponsor: user.owner || user.manager || null });
  try {
    const result = await clientFor(conn).createUserRequest(user, { reqId: req.reqId });
    const requestId = result.requestid || result.requestId || null;
    const requestKey = result.requestkey || result.requestKey || null;
    const workflow = result.jbpmid || null; // e.g. "ExternalIdentityWorkflow.<id>"
    log.info('form.submit_ok', { reqId: req.reqId, formId: form.id, requestId, requestKey, workflow });
    res.json({ ok: true, requestId, requestKey, workflow, message: result.msg || 'Request submitted.' });
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
// Recovery: ADMIN_PASSWORD_RESET=true clears the stored password so the env
// ADMIN_PASSWORD works again (use when locked out, then unset it).
if (process.env.ADMIN_PASSWORD_RESET === 'true' && store.getAdminHash()) {
  store.setAdminHash('');
  log.warn('admin.password_reset', { reason: 'ADMIN_PASSWORD_RESET env flag' });
}
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
