// Thin Saviynt EIC client: logs in with a service account, caches the bearer
// token, refreshes it before it expires, and retries once on a 401.

const http = require('http');
const https = require('https');
const log = require('./log');

const REFRESH_MARGIN_MS = 60 * 1000;

// Low-level request using Node's http/https so we can send a GET with a body
// (some Saviynt endpoints, e.g. getOrganization, are GET + JSON body, which
// the global fetch refuses). Returns { status, text }.
function httpRequest(url, { method, headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      { method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

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
  async call(endpoint, { method = 'POST', body, form = false, reqId } = {}, retried = false) {
    const headers = { Authorization: `Bearer ${await this.getToken()}` };
    const url = `${this.baseUrl}/ECM/${this.apiPath}/${endpoint}`;
    // endpoint name without its query string, for tidy logs.
    const name = endpoint.split('?')[0];
    if (body) log.debug('saviynt.request', { reqId, endpoint: name, method, body });
    const started = Date.now();

    let status;
    let text;
    if (body && form) {
      // Multipart form data (e.g. createUserRequest) — fetch builds the boundaries.
      const fd = new FormData();
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined && v !== null && v !== '') fd.append(k, String(v));
      }
      const res = await fetch(url, { method, headers, body: fd });
      status = res.status;
      text = await res.text();
    } else {
      // JSON (or no) body via Node's http so a GET can carry a body.
      let payload;
      if (body) {
        payload = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      ({ status, text } = await httpRequest(url, { method, headers, body: payload }));
    }

    if (status === 401 && !retried) {
      this.token = null;
      this.expiresAt = 0;
      return this.call(endpoint, { method, body, form, reqId }, true);
    }
    const ms = Date.now() - started;
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      log.error('saviynt.call', { reqId, endpoint: name, method, status, ms, error: 'non-JSON response', snippet: (text || '').slice(0, 200) });
      throw new Error(`Saviynt ${endpoint} returned non-JSON (${status}): ${(text || '').slice(0, 300)}`);
    }
    // Saviynt reports most failures as errorCode != "0" with HTTP 200.
    if (status < 200 || status >= 300 || (data.errorCode !== undefined && String(data.errorCode) !== '0')) {
      log.warn('saviynt.call', { reqId, endpoint: name, method, status, ms, errorCode: data.errorCode, msg: data.msg || data.message });
      const err = new Error(data.msg || data.message || `Saviynt ${endpoint} failed (${status})`);
      err.saviynt = data;
      throw err;
    }
    log.info('saviynt.call', { reqId, endpoint: name, method, status, ms, msg: data.msg });
    if (log.debugEnabled) log.debug('saviynt.response', { reqId, endpoint: name, body: data });
    return data;
  }

  // POST {{url}}/ECM/{{path}}/getOrganization, paging until every org is loaded.
  async getOrganizations({ orgQuery, pageSize = 100, limit = 1000, reqId } = {}) {
    const all = [];
    let offset = 0;
    while (all.length < limit) {
      const body = { max: String(pageSize), offset: String(offset) };
      if (orgQuery) body.orgQuery = orgQuery;
      // getOrganization is a GET that carries a JSON body (per the API reference).
      const data = await this.call('getOrganization', { method: 'GET', body, reqId });
      const page = data.organizations || [];
      all.push(...page);
      offset += page.length;
      if (page.length < pageSize || offset >= Number(data.totalcount || 0)) break;
    }
    return all;
  }

  // GET {{url}}/ECM/{{path}}/user?q=...  — searches users (for a manager picker).
  async searchUsers(query, { max = 50, reqId } = {}) {
    const params = new URLSearchParams({ q: query, fields: 'firstname,lastname,username,email,title,customer,displayname', max: String(max) });
    const data = await this.call(`user?${params.toString()}`, { method: 'GET', reqId });
    return data.results || data.users || [];
  }

  // POST {{url}}/ECM/{{path}}/createUserRequest (multipart form data).
  // Opens a create-user request that follows the tenant's approval workflow.
  // `user` holds firstname/lastname/email/username/manager/etc; extra keys
  // (custom properties, Roles) are passed straight through.
  async createUserRequest(user, { reqId } = {}) {
    return this.call('createUserRequest', { body: user, form: true, reqId });
  }

  // POST {{url}}/ECM/{{path}}/fetchRequestHistory. `username` is the logged-in
  // user whose requests to search (required by Saviynt); filter by requestid.
  async fetchRequestHistory(body, { reqId } = {}) {
    return this.call('fetchRequestHistory', { body, reqId });
  }

  async ping() {
    await this.getToken();
    return true;
  }
}

module.exports = { SaviyntClient };
