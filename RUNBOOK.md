# Demo runbook

A walkthrough for demoing external-user onboarding with the Saviynt request
form. Allow about 10 minutes.

## Before the demo

1. **Pick/prepare a brand.** Copy `brands/default.json` to
   `brands/<prospect>.json`, set the logo URL, colors, and wording. Run with
   `BRAND=<prospect>`.
2. **Fill in `.env`** with the demo tenant URL and a service account that can
   call `getOrganization`, `createUserRequest`, and `fetchRequestHistory`.
3. **Confirm the approval workflow** exists in the tenant for new user
   requests, and that `SAVIYNT_ORG_FIELD` matches the attribute the workflow
   routes on. Know which account approves (the manager/org approver) and have
   it ready to log in to Saviynt.
4. **Smoke test.** `npm start`, open http://localhost:3000, submit one
   request, and confirm it appears in Saviynt pending approval. Delete or
   cancel the test request.

Tip: run `npm run mock` to rehearse the flow with no tenant calls.

## The walkthrough

1. **Open the form.** Point out the branding — this is what the prospect's
   partners or new hires would see.
2. **Choose an organization.** Note the list is pulled live from Saviynt, not
   hardcoded. These are the prospect's real organizations.
3. **Enter the user's details**, review, and submit. Call out the request ID.
4. **Switch to Saviynt** as the approver and show the pending request that the
   form created, then approve it.
5. **Back in the form**, click "Check request status" (or open
   `status.html`), tick auto-refresh, and show the status move to approved /
   provisioned.

## Talking points

- The form is a thin layer over the same Saviynt APIs in Postman — no custom
  connector needed.
- Credentials stay on the backend; the browser never sees them.
- Approvals, routing, and provisioning are all Saviynt's — the form just
  starts the request.
- Branding and fields are a config file, so each prospect gets their own look
  in minutes.

## Reset between demos

Cancel or complete the requests you created (Saviynt UI, or the
`cancelPendingRequest` API). Each run uses a fresh request ID, so no cleanup
is needed in the app itself.
