# Demo runbook

A walkthrough for demoing external-user onboarding with Saviynt Forms. Allow
about 10 minutes.

## Before the demo

1. **Start the app.** `docker compose up --build` (set `ADMIN_PASSWORD` in
   `.env` first). Use `MOCK_MODE=true` to rehearse with no tenant calls.
2. **Set the connection.** In `/admin`, enter the demo tenant URL, `api/v5`,
   and a service account that can call `getOrganization`,
   `createUserRequest`, and `fetchRequestHistory`. Click **Test connection**.
3. **Build the form.** Create a form, brand it for the prospect (heading,
   colors, logo, wording), choose the fields, and set it to **Published**.
   Confirm the **Organization attribute** (`customer` by default) matches what
   your approval workflow routes on.
4. **Confirm the workflow** exists in the tenant for new user requests, and
   have the approver account ready to log in.
5. **Smoke test.** Submit one request on `/f/<name>`, confirm it shows pending
   in Saviynt, then cancel it.

## The walkthrough

1. **Open the form** (`/f/<name>`). Point out the prospect's branding.
2. **Choose an organization** — note the list is pulled live from Saviynt.
3. **Enter the user's details**, review, and submit. Call out the request ID.
4. **Switch to Saviynt** as the approver, show the pending request the form
   created, and approve it.
5. **Back on the form**, click **Check request status**, tick auto-refresh,
   and show the status move to approved / provisioned.

## Talking points

- Thin layer over the same Saviynt APIs that are in Postman — no custom
  connector.
- Credentials stay on the server; the browser never sees them.
- Approvals, routing, and provisioning are all Saviynt's.
- New prospect, new branded form in minutes from the admin console — no code
  or redeploy.

## Reset between demos

Cancel or complete the requests you created (Saviynt UI or
`cancelPendingRequest`). Each run uses a fresh request ID.
