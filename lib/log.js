// Structured logging. One JSON object per line to stdout so `docker compose
// logs` (and Cerebro's container log view) show them with no extra setup.
// Keeps the last N events in memory for the admin "Recent activity" page.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
const RING_MAX = Number(process.env.LOG_BUFFER || 200);

const ring = [];
const SECRET_KEYS = /^(password|pass|token|access_token|refresh_token|authorization|secret|pwd)$/i;

// Remove secrets and trim long values before anything is logged or buffered.
function redact(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? '***' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return value.slice(0, 500) + '…';
  return value;
}

function emit(level, event, fields) {
  if ((LEVELS[level] ?? LEVELS.info) > LEVEL) return;
  const entry = { ts: new Date().toISOString(), level, event, ...redact(fields || {}) };
  ring.push(entry);
  if (ring.length > RING_MAX) ring.shift();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

module.exports = {
  LEVEL_NAME: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  debugEnabled: LEVEL >= LEVELS.debug,
  error: (event, f) => emit('error', event, f),
  warn: (event, f) => emit('warn', event, f),
  info: (event, f) => emit('info', event, f),
  debug: (event, f) => emit('debug', event, f),
  recent: (limit = RING_MAX) => ring.slice(-limit).reverse(),
  redact,
};
