# Weekly Lead Digest

File: `workflows/weekly-lead-digest.json` (10 nodes)

## Business problem

Managers want a weekly view of lead volume, sources and pipeline status, but nobody has time to open the sheet, filter by date and build a summary. Reports get skipped, or are built by hand on Monday morning. This workflow produces the same summary every week with no effort, and also flags a suspiciously quiet week (which often means a broken form).

## Flow in plain English

Every Monday at 08:00 (instance timezone) the workflow reads the whole `Leads` sheet written by the lead-capture workflow. A Code node keeps only rows from the last 7 days, counts them by source and status, and builds both an HTML email and a short Slack message. If there were leads, the digest is emailed and posted to Slack in parallel. If there were none, a "quiet week" notice is posted instead. Failures post to `#automation-errors`.

## Node-by-node

| # | Node | Type | What it does |
|---|------|------|--------------|
| 1 | Every Monday 08:00 | Schedule Trigger | Cron `0 8 * * 1`. |
| 2 | Read Leads Sheet | Google Sheets (read) | Reads all rows. `Always Output Data` is on so an empty sheet still reaches the next node instead of silently ending the run. Retries 3x. |
| 3 | Build Weekly Summary | Code | Filters last 7 days by `received_at`, counts by `source` and `status`, takes newest 5, HTML-escapes every sheet value, outputs `html`, `slackText`, `weekCount`, `hasLeads`. |
| 4 | Any Leads This Week? | IF | Routes on `hasLeads`. |
| 5 | Email Digest | Gmail | Sends the HTML report to the team address. |
| 6 | Post Digest | Slack | Short summary to `#sales-leads`. |
| 7 | Post Quiet Week | Slack | Zero-lead notice with a pointer to check the capture workflow. |
| 8 | Error Trigger | Error Trigger | Fires on any unhandled failure. |
| 9 | Alert Automation Errors | Slack | Workflow, node, message, execution link, timestamp. |
| - | Setup Notes | Sticky Note | Pointer to this document. |

## Setup

1. The sheet must match the lead-capture schema (`email, name, phone, company, message, source, status, received_at`). `received_at` must be ISO-8601, which the capture workflow writes.
2. Import the JSON, assign `YOUR_GOOGLE_SHEETS_CRED`, `YOUR_SLACK_CRED`, `YOUR_GMAIL_CRED`.
3. Replace `YOUR_SPREADSHEET_ID` and `YOUR_TEAM_EMAIL`.
4. Check the instance timezone (Settings > Workflow timezone) so 08:00 means your 08:00.
5. Set the workflow's **Error Workflow** to itself, then execute once manually and activate.

## Customizing

- Change the cron expression for daily or monthly cadence and adjust the `7 * 24` window in the Code node to match.
- Add revenue or pipeline data by inserting a Stripe or HubSpot node before the Code node.

## Expected time saved (estimate)

Assumption: about 30 minutes each Monday to open the sheet, filter, count and write the summary. That is roughly 26 hours per year, plus the report actually happens every week instead of when someone remembers.

## Limits and caveats

- The node reads the full sheet every run. Fine for thousands of rows; for very large sheets, filter in the Sheets node or move to a database.
- Google Sheets read quota is about 60 requests per minute per user; one weekly run is negligible.
- Rows whose `received_at` is missing or unparseable are ignored in the weekly counts but still counted in the total.
