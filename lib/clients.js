// Builds a Saviynt client from the stored connection and caches it (with its
// token) so repeated requests reuse one login. A new client is made only when
// the connection settings change.

const { SaviyntClient } = require('./saviynt');
const { MockSaviyntClient } = require('./mock');

const mockMode = process.env.MOCK_MODE === 'true';
let cached = null;
let cachedKey = null;

function clientFor(connection) {
  if (mockMode) return new MockSaviyntClient();

  const key = JSON.stringify([connection.url, connection.apiPath, connection.username, connection.password]);
  if (cached && cachedKey === key) return cached;

  cached = new SaviyntClient({
    baseUrl: connection.url,
    apiPath: connection.apiPath,
    username: connection.username,
    password: connection.password,
  });
  cachedKey = key;
  return cached;
}

module.exports = { clientFor, mockMode };
