require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { SaviyntClient } = require('./lib/saviynt');
const { MockSaviyntClient } = require('./lib/mock');

const mockMode = process.env.MOCK_MODE === 'true';
const saviynt = mockMode
  ? new MockSaviyntClient()
  : new SaviyntClient({
      baseUrl: process.env.SAVIYNT_URL,
      apiPath: process.env.SAVIYNT_API_PATH,
      username: process.env.SAVIYNT_USERNAME,
      password: process.env.SAVIYNT_PASSWORD,
    });

// Which brand file under brands/ to serve. BRAND=acme.example loads
// brands/acme.example.json; default is brands/default.json.
function loadBrand() {
  const name = process.env.BRAND || 'default';
  const file = path.join(__dirname, 'brands', `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Could not load brand "${name}" (${err.message}); using built-in default.`);
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'brands', 'default.json'), 'utf8'));
  }
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Branding and field config for the current brand. Re-read each request so
// edits show up on refresh without a restart.
app.get('/api/brand', (req, res) => {
  res.json(loadBrand());
});

// Confirms the service account can log in to Saviynt.
app.get('/api/health', async (req, res) => {
  try {
    await saviynt.ping();
    res.json({ ok: true, mode: mockMode ? 'mock' : 'live' });
  } catch (err) {
    res.status(502).json({ ok: false, mode: mockMode ? 'mock' : 'live', error: err.message });
  }
});

// Organizations the requester can choose from. Only the fields the form needs
// are passed to the browser.
app.get('/api/organizations', async (req, res) => {
  try {
    const orgs = await saviynt.getOrganizations({ orgQuery: process.env.SAVIYNT_ORG_QUERY || undefined });
    const result = orgs
      .filter((o) => !o.status || String(o.status).toLowerCase() === 'active')
      .map((o) => ({
        name: o.organizationname,
        description: o.description || '',
        type: o.organizationtype || '',
        parent: o.parentorganization || '',
        location: o.location || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ organizations: result });
  } catch (err) {
    console.error('getOrganization failed:', err.message, err.saviynt || '');
    res.status(502).json({ error: err.message });
  }
});

// Submits a create-user request. The backend decides which fields are allowed
// from the brand config, so the browser can't inject arbitrary Saviynt params.
app.post('/api/request', async (req, res) => {
  const brand = loadBrand();
  const body = req.body || {};

  const organization = String(body.organization || '').trim();
  if (!organization) return res.status(400).json({ error: 'Please choose an organization.' });

  const user = {};
  for (const [key, cfg] of Object.entries(brand.fields || {})) {
    const value = String(body[key] ?? '').trim();
    if (cfg.required && !value) return res.status(400).json({ error: `${cfg.label} is required.` });
    if (value) user[key] = value;
  }

  // Derive a username if the form didn't collect one.
  if (!user.username && user.firstname && user.lastname) {
    user.username = `${user.firstname}.${user.lastname}`.toLowerCase().replace(/[^a-z0-9.]/g, '');
  }
  // Record the chosen organization. customproperty1 is a common place to stash
  // it; adjust to whatever attribute your workflow reads.
  user[process.env.SAVIYNT_ORG_FIELD || 'customproperty1'] = organization;
  if (process.env.SAVIYNT_REQUESTOR) user.requestor = process.env.SAVIYNT_REQUESTOR;

  try {
    const result = await saviynt.createUserRequest(user);
    res.json({
      ok: true,
      requestId: result.requestid || result.requestId || null,
      message: result.msg || 'Request submitted.',
      raw: result,
    });
  } catch (err) {
    console.error('createUserRequest failed:', err.message, err.saviynt || '');
    res.status(502).json({ error: err.message, raw: err.saviynt || null });
  }
});

// Looks up the status of a submitted request. fetchRequestHistory needs a
// username (the logged-in requestor); we use SAVIYNT_REQUESTOR, falling back
// to the service account.
app.get('/api/request-status', async (req, res) => {
  const requestId = String(req.query.requestId || '').trim();
  if (!requestId) return res.status(400).json({ error: 'requestId is required.' });
  const username = process.env.SAVIYNT_REQUESTOR || process.env.SAVIYNT_USERNAME || 'admin';
  try {
    const data = await saviynt.fetchRequestHistory({ username, requestid: requestId, max: '1' });
    const r = (data.requests || [])[0];
    if (!r) return res.status(404).json({ error: `No request found with ID ${requestId}.` });
    res.json({
      requestId: r.requestid,
      type: r.requesttype,
      requestedFor: r.requestedfor,
      submittedOn: r.requestsubmittedon,
      status: r.status ? r.status.trim() : '',
      assignee: r.assignee || '',
      detail: r.requestandtaskstatus || '',
    });
  } catch (err) {
    console.error('fetchRequestHistory failed:', err.message, err.saviynt || '');
    res.status(502).json({ error: err.message });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Saviynt request form on http://localhost:${port} (${mockMode ? 'mock' : 'live'} mode)`);
});
