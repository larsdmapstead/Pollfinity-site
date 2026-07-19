# Opt-In Pipeline (branch: optin-pipeline)

## What this branch changes
The bug: SMSOptIn form posts to Web3Forms, which emails polls@pollfinity.com. No database, no dedupe, no attribution, no list to send to.

The fix: the site becomes a real Worker. Form posts to `/api/optin` on our own domain. Every opt-in lands in a Cloudflare D1 table with UTM attribution, a verbatim consent-text snapshot (TCPA audit trail), phone normalization to E.164, and dedupe on phone/email. Web3Forms notification email still fires, so nothing about the current workflow breaks.

Files: `src/worker.js` (new), `schema.sql` (new), `wrangler.toml` (updated), `SMSOptIn.html` (endpoint swap + hidden UTM/consent fields + honeypot).

## Deploy (one time, ~10 minutes, from any machine with wrangler auth)
1. `wrangler d1 create pollfinity-panel` and paste the returned database_id into wrangler.toml
2. `wrangler d1 execute pollfinity-panel --remote --file=schema.sql`
3. `wrangler secret put ADMIN_KEY` (any long random string)
4. `wrangler deploy`
5. Test: submit the form once, then `curl "https://pollfinity.com/api/optin/count"`

## Endpoints
- `POST /api/optin` form handler
- `GET /api/optin/count` public panelist count (use it for a "1,234 panelists and counting" widget on the page; social proof lifts conversion)
- `GET /api/optin/export?key=ADMIN_KEY` CSV for Prompt.io / ESP import; add `&status=confirmed` to filter

## Prompt.io hookup
Until the Prompt.io contact-API endpoint is confirmed with their team, the loop is: weekly CSV pull from `/api/optin/export`, import to Prompt.io, send the double opt-in confirmation ("Reply YES to confirm"), mark confirmed. Once their API is confirmed, add a direct push in `worker.js` (stub goes where the Web3Forms notify call is) and this becomes fully automatic.

## Status lifecycle
pending (form submitted) -> confirmed (replied YES to the confirmation text) -> revoked (STOP at any time). Prompt.io handles STOP automatically; sync revocations back on each export cycle.
