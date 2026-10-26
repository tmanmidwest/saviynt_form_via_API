// Thin Saviynt EIC client: logs in with a service account, caches the bearer
// token, refreshes it before it expires, and retries once on a 401.

const REFRESH_MARGIN_MS = 60 * 1000;

class SaviyntClient {
  constructor({ baseUrl, apiPath, username, password }) {
    if (!baseUrl || !username || !password) {
      throw new Error('SAVIYNT_URL, SAVIYNT_USERNAME and SAVIYNT_PASSWORD must be set (or use MOCK_MODE=true)');
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiPath = (apiPath || 'api/v5').replace(/^\/+|\/+$/g, '');
    this.username = username;
    this.password = password;
    this.token = null;
    this.refreshToken = null;
    this.expiresAt = 0;
  }

  // POST {{url}}/ECM/api/login
  async login() {
    const res = await fetch(`${this.baseUrl}/ECM/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    if (!res.ok) throw new Error(`Saviynt login failed (${res.status}): ${await res.text()}`);
    this.storeToken(await res.json());
  }

  // POST {{url}}/ECM/oauth/access_token (grant_type=refresh_token)
  async refresh() {
    const res = await fetch(`${this.baseUrl}/ECM/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.refreshToken }),
    });
    if (!res.ok) throw new Error(`Saviynt token refresh failed (${res.status})`);
    this.storeToken(await res.json());
  }

  storeToken(data) {
    this.token = data.access_token;
    // The refresh response can return an empty refresh_token; keep the old one then.
    if (data.refresh_token) this.refreshToken = data.refresh_token;
    this.expiresAt = Date.now() + (Number(data.expires_in) || 1800) * 1000;
  }

  async getToken() {
    if (this.token && Date.now() < this.expiresAt - REFRESH_MARGIN_MS) return this.token;
    if (this.refreshToken) {
      try {
        await this.refresh();
        return this.token;
      } catch {
        // Refresh tokens can be invalidated at any time; fall back to a full login.
      }
    }
    await this.login();
    return this.token;
  }

  // Calls {{url}}/ECM/{{path}}/<endpoint>. `body` is sent as JSON, or as
  // multipart form data when `form` is true (some endpoints only accept that).
  async call(endpoint, { method = 'POST', body, form = false } = {}, retried = false) {
    const headers = { Authorization: `Bearer ${await this.getToken()}` };
    let payload;
    if (body && form) {
      payload = new FormData();
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined && v !== null && v !== '') payload.append(k, String(v));
      }
    } else if (body) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}/ECM/${this.apiPath}/${endpoint}`, { method, headers, body: payload });
    if (res.status === 401 && !retried) {
      this.token = null;
      this.expiresAt = 0;
      return this.call(endpoint, { method, body, form }, true);
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Saviynt ${endpoint} returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
    }
    // Saviynt reports most failures as errorCode != "0" with HTTP 200.
    if (!res.ok || (data.errorCode !== undefined && String(data.errorCode) !== '0')) {
      const err = new Error(data.msg || data.message || `Saviynt ${endpoint} failed (${res.status})`);
      err.saviynt = data;
      throw err;
    }
    return data;
  }

  // POST {{url}}/ECM/{{path}}/getOrganization, paging until every org is loaded.
  async getOrganizations({ orgQuery, pageSize = 100, limit = 1000 } = {}) {
    const all = [];
    let offset = 0;
    while (all.length < limit) {
      const body = { max: String(pageSize), offset: String(offset) };
      if (orgQuery) body.orgQuery = orgQuery;
      const data = await this.call('getOrganization', { body });
      const page = data.organizations || [];
      all.push(...page);
      offset += page.length;
      if (page.length < pageSize || offset >= Number(data.totalcount || 0)) break;
    }
    return all;
  }

  // POST {{url}}/ECM/{{path}}/createUserRequest (multipart form data).
  // Opens a create-user request that follows the tenant's approval workflow.
  // `user` holds firstname/lastname/email/username/manager/etc; extra keys
  // (custom properties, Roles) are passed straight through.
  async createUserRequest(user) {
    return this.call('createUserRequest', { body: user, form: true });
  }

  // POST {{url}}/ECM/{{path}}/fetchRequestHistory. `username` is the logged-in
  // user whose requests to search (required by Saviynt); filter by requestid.
  async fetchRequestHistory(body) {
    return this.call('fetchRequestHistory', { body });
  }

  async ping() {
    await this.getToken();
    return true;
  }
}

module.exports = { SaviyntClient };
