# Saviynt Forms

A self-hosted container app for building branded, external-user request forms
backed by the Saviynt EIC API. Create and manage multiple forms from an admin
console; each form lists organizations live from Saviynt and submits a
create-user request that runs through your tenant's approval workflow.

Browsers only talk to this app. The app holds the Saviynt service account,
manages the bearer token, and calls Saviynt.

## Run with Docker

```bash
cp .env.example .env     # set ADMIN_PASSWORD (and MOCK_MODE=true to try it dry)
docker compose up --build
```

Then:
- **Admin console:** http://localhost:3000/admin (log in with `ADMIN_USER` /
  `ADMIN_PASSWORD` from `.env`)
- **Public site:** http://localhost:3000

The Saviynt connection and all forms are stored in `data/config.json`, mounted
as a volume so they survive restarts.

## Run without Docker

```bash
npm install
cp .env.example .env
npm start            # or: npm run mock
```

## Using it

1. In the admin console, fill in the **Saviynt connection** (tenant URL,
   `api/v5` path, service account, requestor) and click **Test connection**.
   The service account needs access to `getOrganization`, `createUserRequest`,
   and `fetchRequestHistory`.
2. Create a **form**. Edit its heading, tagline, intro, colors, logo, and the
   fields to collect. Set it to **Published** to make it live.
3. Share the form's URL, `/f/<name>`. The requester picks an organization
   (live from Saviynt), enters details, reviews, and submits.

### How the organization is set

The chosen organization is written to the native Saviynt user attribute
**`customer`** (the API reference describes `customer` as "pass the
organization name"). Change the **Organization attribute** on the connection,
or per form, if your workflow routes on something else.

## Saviynt APIs used

`{{url}}` is the tenant URL, `{{path}}` the API path (usually `api/v5`).

| Purpose | Call |
| --- | --- |
| Log in | `POST {{url}}/ECM/api/login` |
| Refresh token | `POST {{url}}/ECM/oauth/access_token` |
| List organizations | `POST {{url}}/ECM/{{path}}/getOrganization` |
| Create user request | `POST {{url}}/ECM/{{path}}/createUserRequest` |
| Request status | `POST {{url}}/ECM/{{path}}/fetchRequestHistory` |

## Deploying with a Docker stack deployer (e.g. Cerebro)

The repo is ready for a "deploy a compose stack from Git" workflow:

- **Source:** Git repository, branch `main`, compose path `docker-compose.yml`
  (repo root), with "build images from the repo" turned on (`build: .`).
- **Private repo:** the deployer needs a stored Git credential with read
  access to this repository, or the clone will fail.
- **Environment:** set `ADMIN_USER`, `ADMIN_PASSWORD`, `MOCK_MODE`, and `PORT`
  (host port) in the deployer's environment box; it writes them to a `.env`
  beside the compose file. See `.env.example` for the keys.
- **Persistence:** config lives on the named volume `forms-data`, so the
  Saviynt connection and forms you set in the UI survive redeploys and
  force-recreate.
- **Health:** the container exposes `GET /healthz` and a Docker `HEALTHCHECK`.

## Running a demo

See [RUNBOOK.md](RUNBOOK.md).

## Layout

- `server.js` — Express app (admin API, public form API, static pages)
- `lib/saviynt.js` — Saviynt client (login, token refresh, calls)
- `lib/store.js` — reads/writes `data/config.json`
- `lib/clients.js` — builds and caches the client from the stored connection
- `lib/mock.js` — offline stand-in for `MOCK_MODE=true`
- `public/` — landing page, `form.html` (public form), `status.html`, `admin/`
