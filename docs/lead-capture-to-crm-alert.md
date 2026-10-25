# Lead Capture to Sheet + Slack Alert

File: `workflows/lead-capture-to-crm-alert.json` (15 nodes)

## Business problem

Leads arrive from a website form and sit in an inbox until someone copies them into a spreadsheet or CRM. Replies are slow, duplicates pile up, and nobody on the team knows a lead arrived until they check email. This workflow stores every lead the moment it is submitted, tells the sales channel, and sends the lead an acknowledgement.

## Flow in plain English

A signed POST arrives from the form. The signature is checked; bad requests get a 401 and stop. Good requests are cleaned (trimmed, lowercased email, length-capped fields) and the email is validated. The lead is upserted into a Google Sheet keyed on email (so a resubmission updates the row instead of duplicating it). Sales gets a Slack message, the lead gets an auto-reply, and the form receives a 200. A separate Error Trigger branch posts any unhandled failure to `#automation-errors`.

## Node-by-node

| # | Node | Type | What it does |
|---|------|------|--------------|
| 1 | Lead Form Webhook | Webhook (POST `/lead-capture`) | Receives the form. `rawBody` is on so the HMAC can be computed over the exact bytes. Response is deferred to a Respond node. |
| 2 | Verify HMAC Signature | Code | Checks `X-Signature` (`sha256=<hex>`) over `<X-Timestamp>.<raw body>`, rejects timestamps older than 5 minutes, uses `timingSafeEqual`, fails closed if `WEBHOOK_SECRET` is unset. |
| 3 | Signature Valid? | IF | Splits on `valid`. |
| 4 | Respond 401 | Respond to Webhook | Generic `unauthorized` body. The reason is not leaked to the caller. |
| 5 | Normalize Lead | Set | Maps `email, name, phone, company, message, source`, trims, lowercases email, caps lengths, adds `status=New` and `received_at`. |
| 6 | Email Looks Valid? | IF | Regex sanity check on email. |
| 7 | Respond 422 | Respond to Webhook | `invalid_email` for bad input. |
| 8 | Upsert Lead Row | Google Sheets (append or update) | Matches on `email`. Cell format `RAW` so values like `=HYPERLINK(...)` are stored as text, not evaluated. Retries 3x. |
| 9 | Alert Sales Channel | Slack | Posts lead summary to `#sales-leads`. |
| 10 | Send Auto-Reply | Gmail | Plain-text acknowledgement. Uses the error output, not a silent failure. |
| 11 | Alert Auto-Reply Failed | Slack | If Gmail fails, tells `#automation-errors` that the lead is saved but needs manual follow-up. |
| 12 | Respond 200 | Respond to Webhook | `{ "ok": true }`. Reached from both Gmail outcomes. |
| 13 | Error Trigger | Error Trigger | Fires on any unhandled failure. |
| 14 | Alert Automation Errors | Slack | Workflow name, failing node, message, execution link, timestamp. |
| - | Setup Notes | Sticky Note | Reminder of required env vars. |

## Setup

1. Create a Google Sheet with a tab named `Leads` and header row exactly: `email, name, phone, company, message, source, status, received_at`.
2. Set n8n environment variables: `WEBHOOK_SECRET` (long random string), `NODE_FUNCTION_ALLOW_BUILTIN=crypto`, `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.
3. Import the JSON. Assign credentials on the Sheets, Slack and Gmail nodes (placeholders `YOUR_GOOGLE_SHEETS_CRED`, `YOUR_SLACK_CRED`, `YOUR_GMAIL_CRED`).
4. Replace `YOUR_SPREADSHEET_ID` and `YOUR_COMPANY_NAME`. Adjust the Slack channel names.
5. In workflow Settings, set **Error Workflow** to this same workflow so the Error Trigger branch is live.
6. Copy the **Production URL** of the webhook node into your form backend and sign requests (see README, "Signing requests").
7. Test with a signed `curl`, check the row, the Slack message and the email, then activate.

## Customizing

- Swap Google Sheets for HubSpot or GoHighLevel by replacing node 8; keep email as the dedupe key.
- Add fields by extending the Set node and the sheet header together.

## Expected time saved (estimate)

Assumptions: 40 leads per week, about 4 minutes each to copy details into a sheet, post to the team and send an acknowledgement. That is roughly 2.5 hours per week, about 130 hours per year. Faster first response is a further, unmeasured gain. Adjust the numbers to your volume.

## Limits and caveats

- Google Sheets API allows roughly 60 write requests per minute per user; fine for form traffic, not for bulk imports.
- Gmail sending is capped (about 500 per day on a free account).
- Slack message text includes user-supplied content; it is length-capped but not stripped of mentions like `@channel`.
