# n8n Automation Pack

Three production-style n8n workflows for small-business lead handling, exported as importable JSON with placeholder credentials only. Each one follows the same pattern: trigger, filter, transform, action, with a dedicated error branch so failures are never silent.

## Workflows

| Workflow | Trigger | What it automates | Docs |
|----------|---------|-------------------|------|
| Lead Capture to Sheet + Slack Alert | Signed webhook | Verify, clean, dedupe-upsert a lead into Google Sheets, alert Slack, email an auto-reply | [docs](docs/lead-capture-to-crm-alert.md) |
| Weekly Lead Digest | Schedule (Mon 08:00) | Summarize the last 7 days by source and status, email and post to Slack, flag quiet weeks | [docs](docs/weekly-lead-digest.md) |
| Signup Enrichment + Hot Lead Alert | Signed webhook | Enrich a signup via API, score it, upsert into HubSpot, alert sales on strong fits | [docs](docs/signup-enrichment-hot-lead-alert.md) |

Files live in [`workflows/`](workflows/). Every workflow includes an Error Trigger branch that posts to `#automation-errors`.

## Design principles

- Authenticate and filter first; stop bad input before any side effect.
- Idempotent writes (upsert on email) so retries and replays do not duplicate data.
- Retries with a delay on external calls; error outputs where a failure should be reported but not block the response.
- Respond to the caller explicitly (401, 422, 202, 200) instead of leaving requests hanging.
- No credentials, IDs, or URLs in the exports.

## How to import

1. In n8n: **Workflows > Add workflow > Import from file** and choose a JSON file from `workflows/`.
2. Open each node showing a credential warning and select (or create) your credential. The placeholders are:
   `YOUR_GOOGLE_SHEETS_CRED`, `YOUR_SLACK_CRED`, `YOUR_GMAIL_CRED`, `YOUR_HUBSPOT_CRED`, `YOUR_ENRICHMENT_HEADER_AUTH_CRED`.
3. Replace remaining placeholders: `YOUR_SPREADSHEET_ID`, `YOUR_TEAM_EMAIL`, `YOUR_COMPANY_NAME`, the Slack channel names, and the example enrichment URL.
4. In workflow **Settings**, set **Error Workflow** to the same workflow so its Error Trigger branch is live.
5. Follow the setup section of the matching doc, test with the signed request below, then activate.

Workflows are exported with `active: false`.

## Security notes

### HMAC verification on webhooks

The two webhook workflows do not rely on a secret URL. Each request must carry:

- `X-Timestamp`: unix time in seconds
- `X-Signature`: `sha256=` followed by the hex HMAC-SHA256 of `<timestamp>.<raw request body>` using a shared secret

The `Verify HMAC Signature` Code node:

- computes the HMAC over the raw bytes (the Webhook node has `rawBody` enabled, so re-serialized JSON never causes false mismatches);
- compares with `crypto.timingSafeEqual`;
- rejects timestamps more than 5 minutes old to limit replay;
- fails closed if `WEBHOOK_SECRET` is missing;
- returns a generic 401 and never tells the caller why verification failed.

Required n8n environment:

```
WEBHOOK_SECRET=<long random string, never committed>
NODE_FUNCTION_ALLOW_BUILTIN=crypto
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

Setting `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` lets every Code node on the instance read environment variables. On a shared instance, consider a dedicated instance or an external secret manager instead.

### Signing requests (for testing)

```bash
BODY='{"email":"test@YOUR_DOMAIN","name":"Test","source":"curl"}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')
curl -X POST "https://YOUR_N8N_HOST/webhook-test/lead-capture" \
  -H "Content-Type: application/json" \
  -H "X-Timestamp: $TS" \
  -H "X-Signature: sha256=$SIG" \
  --data "$BODY"
```

Use `/webhook-test/` while the workflow is open in the editor and `/webhook/` once it is active. Send the body byte-for-byte as signed.

### Other notes

- Replay inside the 5-minute window is possible; the workflows are designed so replays are harmless (upsert on email).
- Sheet writes use `RAW` cell format to prevent spreadsheet formula injection from form input.
- Digest output HTML-escapes all sheet-sourced text.
- User-supplied text posted to Slack is length-capped but mentions are not stripped.
- Never commit exports that contain real credential IDs. Run `node scripts/validate.mjs` before committing; it fails on any credential not named `YOUR_*`.

## Validation

```bash
node scripts/validate.mjs
```

A dependency-free structural check: JSON shape, unique node names and ids, connection integrity, no orphaned nodes, Error Trigger present, HMAC node present on webhook workflows, placeholder-only credentials, and a JavaScript syntax check of every Code node. It does not replace importing into n8n.

## Compatibility

Built against current n8n node versions (Webhook 2, IF 2.2, Set 3.4, Google Sheets 4.5, Gmail 2.1, Slack 2.3, HTTP Request 4.2, HubSpot 2). Older n8n releases may not recognize these versions.

## License

MIT. See [LICENSE](LICENSE).
