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

## Saviynt APIs used

These match the Saviynt EIC v24.2 Postman collection. `{{url}}` is
`SAVIYNT_URL` and `{{path}}` is `SAVIYNT_API_PATH` (usually `api/v5`).

| Purpose | Call |
| --- | --- |
| Log in | `POST {{url}}/ECM/api/login` |
| Refresh token | `POST {{url}}/ECM/oauth/access_token` |
| List organizations | `POST {{url}}/ECM/{{path}}/getOrganization` |

The service account needs permission to call these APIs (for example
`ROLE_ADMIN` in a demo tenant). Set `SAVIYNT_ORG_QUERY` to limit which
organizations the form offers, using the `orgQuery` syntax from the
collection, e.g. `c.parentorganization = 'External Partners'`.

## Backend endpoints

- `GET /api/health`: checks that the service account can log in.
- `GET /api/organizations`: active organizations, sorted by name.
