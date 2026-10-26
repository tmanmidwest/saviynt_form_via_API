// Config persistence. Everything the app needs (the Saviynt connection and
// the forms) lives in one JSON file on a mounted volume so it survives
// container restarts. No database to keep setup simple.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  connection: {
    url: '',
    apiPath: 'api/v5',
    username: '',
    password: '',
    requestor: '',
    // Native Saviynt user attribute that holds the primary organization.
    orgField: 'customer',
    orgQuery: '',
    // Template for the manager/user lookup search. {q} = typed text,
    // {org} = selected organization. Tune to the tenant's query syntax.
    userSearchQuery: 'username:{q}*',
  },
  forms: [],
};

function defaultForm(id, name) {
  return {
    id,
    name: name || id,
    enabled: true,
    productName: 'Access Request Portal',
    tagline: 'Request access for a new external user',
    intro: 'Use this form to request a new user account for an external organization. Your request is routed for approval before the account is created.',
    successMessage: 'Request submitted. An approver will review it before the account is created.',
    logoUrl: '',
    colors: {
      primary: '#2563eb', primaryText: '#ffffff', accent: '#1e40af',
      background: '#f8fafc', surface: '#ffffff', text: '#1f2937', muted: '#6b7280',
    },
    // Order matters; rendered top to bottom.
    fields: [
      { key: 'firstname', label: 'First name', required: true, type: 'text', help: '' },
      { key: 'lastname', label: 'Last name', required: true, type: 'text', help: '' },
      { key: 'email', label: 'Email', required: true, type: 'email', help: '' },
      { key: 'manager', label: 'Manager', required: false, type: 'userLookup', help: 'Start typing to search Saviynt users.' },
    ],
    // Optional overrides of the connection defaults.
    orgQuery: '',
    orgField: '',
    // Limit manager/user lookups to the selected organization.
    scopeManagerToOrg: false,
    // #### separated role names to assign to the new user, or ''.
    roles: '',
  };
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function read() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      connection: { ...DEFAULT_CONFIG.connection, ...(raw.connection || {}) },
      forms: Array.isArray(raw.forms) ? raw.forms : [],
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function write(config) {
  ensureDir();
  // Write atomically so a crash mid-write can't corrupt the file.
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
  return config;
}

function getConnection() {
  return read().connection;
}

function setConnection(patch) {
  const config = read();
  config.connection = { ...config.connection, ...patch };
  write(config);
  return config.connection;
}

function listForms() {
  return read().forms;
}

function getForm(id) {
  return read().forms.find((f) => f.id === id) || null;
}

// Turn a display name into a URL-safe slug, unique against existing forms.
function slugify(name, taken) {
  let base = String(name || 'form').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'form';
  let id = base;
  let n = 2;
  while (taken.includes(id)) id = `${base}-${n++}`;
  return id;
}

function createForm(partial) {
  const config = read();
  const id = slugify(partial.id || partial.name, config.forms.map((f) => f.id));
  const form = { ...defaultForm(id, partial.name), ...partial, id };
  config.forms.push(form);
  write(config);
  return form;
}

function updateForm(id, patch) {
  const config = read();
  const i = config.forms.findIndex((f) => f.id === id);
  if (i === -1) return null;
  // id stays fixed so public URLs don't break.
  config.forms[i] = { ...config.forms[i], ...patch, id };
  write(config);
  return config.forms[i];
}

function deleteForm(id) {
  const config = read();
  const before = config.forms.length;
  config.forms = config.forms.filter((f) => f.id !== id);
  if (config.forms.length === before) return false;
  write(config);
  return true;
}

// On first run (no config file yet), seed one starter form so the admin and
// public site aren't empty.
function initIfMissing() {
  if (fs.existsSync(CONFIG_PATH)) return;
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  config.forms.push(defaultForm('external-user', 'External user request'));
  write(config);
}

module.exports = {
  CONFIG_PATH, DATA_DIR, defaultForm, initIfMissing,
  read, write, getConnection, setConnection,
  listForms, getForm, createForm, updateForm, deleteForm,
};
