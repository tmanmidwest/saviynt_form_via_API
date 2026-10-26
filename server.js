require('dotenv').config();
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

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Saviynt request form on http://localhost:${port} (${mockMode ? 'mock' : 'live'} mode)`);
});
