# Signup Enrichment + Hot Lead Alert

File: `workflows/signup-enrichment-hot-lead-alert.json` (13 nodes)

## Business problem

Every new signup looks the same in the CRM: an email address and a name. Sales cannot tell a founder at a 300-person company from a student, so high-value signups wait in the same queue as everyone else. This workflow enriches each signup with company and role data, scores it, writes the enriched contact to the CRM, and pings sales immediately when the lead is a strong fit.

## Flow in plain English

Your app posts a signed signup event. A bad signature gets a 401. A good one is acknowledged immediately with a 202 (so the sender is not held up by the enrichment call), then the workflow looks the email up in an enrichment API with retries. If enrichment fails or finds nothing, the run continues in a degraded mode rather than dropping the signup. A Code node merges signup and enrichment data and computes a simple fit score. The contact is upserted into HubSpot (email is the dedupe key, so replays are safe). If the score is 4 or higher, sales is alerted in Slack.

## Node-by-node

| # | Node | Type | What it does |
|---|------|------|--------------|
| 1 | Signup Webhook | Webhook (POST `/signup-enrich`) | Receives `{ email, first_name, last_name, company }`. `rawBody` on for HMAC. |
| 2 | Verify HMAC Signature | Code | Same verification as the lead-capture workflow: timestamp window, constant-time compare, fail closed. |
| 3 | Signature Valid? | IF | Splits on `valid`. |
| 4 | Respond 401 | Respond to Webhook | Generic unauthorized response. |
| 5 | Respond 202 | Respond to Webhook | Acknowledges immediately; execution continues afterwards. |
| 6 | Enrich Contact | HTTP Request | GET to a placeholder enrichment URL with header-auth credential, 10 s timeout, 3 tries with 2 s wait. "On error: continue" so a failed lookup does not lose the signup. |
| 7 | Score Lead | Code | Merges signup with enrichment, scores: employees 200+ (+3) or 50+ (+2); senior title (+2); non-free-mail domain (+1). `hot` when score is 4 or more. Marks `enrichmentStatus`. |
| 8 | Upsert HubSpot Contact | HubSpot | Upsert by email with name, company and job title. Retries 3x. |
| 9 | Hot Lead? | IF | Routes on `hot`. |
| 10 | Alert Sales: Hot Lead | Slack | Score, name, title, company, size, enrichment status, LinkedIn. |
| 11 | Error Trigger | Error Trigger | Fires on any unhandled failure. |
| 12 | Alert Automation Errors | Slack | Workflow, node, message, execution link, timestamp. |
| - | Setup Notes | Sticky Note | Required env vars and the enrichment placeholder warning. |

## Setup

1. Set env vars: `WEBHOOK_SECRET`, `NODE_FUNCTION_ALLOW_BUILTIN=crypto`, `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.
2. Import the JSON and assign credentials: `YOUR_ENRICHMENT_HEADER_AUTH_CRED` (Header Auth: the header name and key your provider requires), `YOUR_HUBSPOT_CRED` (private app token with contacts write scope), `YOUR_SLACK_CRED`.
3. Replace the placeholder URL `https://api.enrichment.example.com/v1/lookup` with your provider's endpoint and adjust the query parameter name.
4. The Score Lead node assumes a response shaped like `{ person: { title, linkedin_url }, company: { name, employees } }`. Edit the mapping to match your provider.
5. Tune the scoring weights and the `score >= 4` threshold to your ideal customer profile.
6. Set the workflow's **Error Workflow** to itself, send a signed test request, then activate.

## Expected time saved (estimate)

Assumptions: 60 signups per week, about 3 minutes each of manual research (LinkedIn, company site) before deciding who to contact. That is roughly 3 hours per week, about 150 hours per year. The larger benefit is speed: hot leads reach sales in seconds instead of the next time someone checks the CRM.

## Limits and caveats

- Enrichment providers rate-limit and bill per lookup; the retry setting multiplies calls on failures, so lower `maxTries` if billing matters.
- HubSpot private-app tokens are limited to about 100 requests per 10 seconds on most plans.
- Because the 202 is returned before processing, the sender cannot know whether CRM sync succeeded. Failures are surfaced to Slack via the Error Trigger branch instead.
