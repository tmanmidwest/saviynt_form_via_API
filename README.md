# Saviynt request form

A small local app for demoing external-user onboarding with Saviynt EIC. A
branded form lists organizations from Saviynt and submits a create-user
request that runs through the approval workflow set up in the tenant.

The browser only talks to the local Node backend. The backend holds the
Saviynt service account, manages the bearer token, and calls the Saviynt API.

## Run it

```bash
npm install
cp .env.example .env   # fill in your tenant URL and service account
npm start              # http://localhost:3000
```

To try it without a tenant, run `npm run mock`, which serves sample
organizations instead of calling Saviynt.

## How the form works

1. **Organization** — a live dropdown of active Saviynt organizations.
2. **User details** — fields driven by the brand config (first/last name,
   email, manager by default).
3. **Review & submit** — opens a `createUserRequest`, which enters the
   tenant's approval workflow. The returned request ID is shown.

The chosen organization is written to the Saviynt attribute named by
`SAVIYNT_ORG_FIELD` (default `customproperty1`). Set that to whatever
attribute your approval workflow actually keys on so the request routes to
the right org/manager approver.

## Branding

Each brand is a JSON file in `brands/`. Copy `brands/default.json` (or
`brands/acme.example.json`) to `brands/<yourbrand>.json`, edit the logo URL,
colors, wording and fields, then run with `BRAND=<yourbrand>`. Edits show up
on page refresh without a restart.

## Saviynt APIs used

These match the Saviynt EIC v24.2 Postman collection. `{{url}}` is
`SAVIYNT_URL` and `{{path}}` is `SAVIYNT_API_PATH` (usually `api/v5`).

| Purpose | Call |
| --- | --- |
| Log in | `POST {{url}}/ECM/api/login` |
| Refresh token | `POST {{url}}/ECM/oauth/access_token` |
| List organizations | `POST {{url}}/ECM/{{path}}/getOrganization` |
| Create user request | `POST {{url}}/ECM/{{path}}/createUserRequest` |

The service account needs permission to call these APIs (for example
`ROLE_ADMIN` in a demo tenant). Set `SAVIYNT_ORG_QUERY` to limit which
organizations the form offers, using the `orgQuery` syntax from the
collection, e.g. `c.parentorganization = 'External Partners'`.

## Checking status

After submitting, the success screen links to `status.html`, which looks up
the request via `fetchRequestHistory` and can auto-refresh — useful for
showing an approval land live during a demo.

## Running a demo

See [RUNBOOK.md](RUNBOOK.md) for a step-by-step walkthrough.

## Backend endpoints

- `GET /api/health`: checks that the service account can log in.
- `GET /api/organizations`: active organizations, sorted by name.
- `POST /api/request`: submits a create-user request.
- `GET /api/request-status?requestId=...`: status of a submitted request.
