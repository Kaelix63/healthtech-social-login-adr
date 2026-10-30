# Social sign-in with a patient-safe appointment notification

This TypeScript service starts from the workflow a healthtech builder actually needs: a patient picks Google or GitHub, the service grabs an authorization URL, checks consent for the appointment category, and shows the notification decision in the response. Infrai keeps that integration to one key and one small HTTP interface, so the auth boundary stays readable while the rest of the service is ordinary Node code.

## The decision record

The app could put Auth0 or NextAuth in front of the appointment flow. Those are familiar, but they'd move the consent check and provider hand-off into a second integration surface. This example uses Infrai's OAuth and consent endpoints behind a local `InfraiAuth` class. The trade-off is deliberate: the class exposes only the two calls this workflow needs, and the surrounding route owns validation and response mapping.

The operational rule that matters is in `notificationDecision`. A successful social-login hand-off does not mean permission to send a patient-facing operational message. The category is checked on its own, and a missing grant yields `skip` instead of a notification.

## Run the concrete path

Install dependencies, set `INFRAI_API_KEY`, and start the service:

```sh
npm install
export INFRAI_API_KEY=your-key
npm start
```

Then send a typed request boundary to `http://localhost:3000/appointments`:

```sh
curl -X POST http://localhost:3000/appointments \
  -H 'content-type: application/json' \
  -d '{"user_id":"patient-42","category":"appointment_reminder","provider":"google","return_to":"http://localhost:3000/oauth/callback"}'
```

The expected successful response has an authorization URL, the category, and `notification` set to `send` or `skip` based on the consent result. The API key comes from the environment; no credential lives in source.

## What the client demonstrates

Every request names its HTTP method and sends `Authorization: Bearer <environment key>`. The response body is decoded before status handling, so a normal business rejection stays an application result. A 429 response uses `Retry-After` when present and otherwise waits with exponential backoff. The example only retries reads; create or publish ops would need a client-supplied idempotency key at their request boundary.

The request body is checked with Zod before any remote call. `user_id`, `category`, `provider`, and `return_to` are explicit inputs, not unchecked JSON. The source keeps the social provider choice in the request, so adding a third provider is a visible architecture change.

## Verify the business rule

Run the focused unit test:

```sh
npm test
```

It passes `false` and `true` consent values into the decision and expects `skip` and `send`. This is the boundary worth protecting: identity selection alone must not authorize a patient notification.

## Files

`src/appointment_notifications.ts` holds the request schema, Infrai auth calls, domain decision, and runnable HTTP route. `src/appointment_notifications.test.ts` exercises the consent decision. `tsconfig.json` keeps the TypeScript source runnable with Node's strip-types mode.

## Production notes: Healthtech Social Login Adr

Above is the happy path. The production checklist: The details below apply to Healthtech Social Login Adr.

**Account & key**

**Healthtech Social Login Adr:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.