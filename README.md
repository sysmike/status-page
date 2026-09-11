# status-page

Uptime monitoring that runs entirely on GitHub: checks run as a scheduled
Action, history is committed to this repository, outages open and close GitHub
issues, and the status page is published with GitHub Pages.

## Setup

1. Fork or copy this repository.
2. **Settings → Pages → Source**: select *GitHub Actions*.
3. **Settings → Actions → General → Workflow permissions**: select *Read and
   write permissions*.
4. Add one repository variable per monitor under **Settings → Secrets and
   variables → Actions → Variables** (see below).
5. Run the **Uptime** workflow once from the Actions tab.

## Monitors

Every monitor is a repository variable named `MONITOR_<NAME>`. The name after
the prefix becomes the slug and the default display name. The value is either a
plain URL or a JSON object.

```
MONITOR_WEBSITE   https://example.com
MONITOR_API       {"name":"Public API","url":"https://api.example.com/health","keyword":"ok","group":"Core"}
```

| Key | Default | Description |
| --- | --- | --- |
| `url` | required | URL to request |
| `name` | derived from the variable name | Display name |
| `method` | `GET` | HTTP method |
| `headers` | `{}` | Request headers |
| `body` | none | Request body |
| `expectedStatus` | `2xx` | Status code, `2xx` style pattern, `200-299` range, or an array of those |
| `keyword` | none | Response body must contain this string |
| `timeout` | `10000` | Milliseconds before the request is aborted |
| `retries` | `1` | Extra attempts before a check counts as failed |
| `degradedMs` | `0` | Responses slower than this are reported as degraded (`0` disables) |
| `followRedirects` | `true` | Follow 3xx responses |
| `group` | none | Groups monitors under a heading |
| `description` | none | Subtitle on the card |
| `link` | `url` | Link target of the monitor name |
| `order` | `100` | Sort order within a group |
| `slug` | derived from the variable name | Overrides the slug used for history files |

## Site variables

| Variable | Default | Description |
| --- | --- | --- |
| `SITE_TITLE` | `Status` | Page and browser title |
| `SITE_DESCRIPTION` | none | Line under the status banner |
| `SITE_LINK` | none | Link in the footer |
| `SITE_LOGO` | none | Logo URL shown next to the title |
| `SITE_THEME` | `auto` | `auto`, `light` or `dark` |
| `INCIDENT_THRESHOLD` | `2` | Consecutive failed checks before an issue is opened |
| `INCIDENT_LABELS` | `status,incident` | Labels applied to incident issues |

## How it works

`.github/workflows/uptime.yml` runs every five minutes:

1. `scripts/check.mjs` requests every monitor and appends the result to
   `history/`.
2. `scripts/incidents.mjs` opens an issue when a monitor has failed
   `INCIDENT_THRESHOLD` times in a row, comments the downtime and closes the
   issue on recovery, and writes a snapshot of recent incidents.
3. The history is committed back to the branch.
4. If any monitor changed state, the Pages workflow deploys immediately;
   otherwise the site rebuilds on its own 15 minute schedule.

`.github/workflows/pages.yml` runs `scripts/build.mjs`, which turns the history
into `_site/api/*.json` next to the static page in `site/`.

History is stored per monitor as CSV:

```
history/raw/<slug>.csv     every check of the last 7 days (response time chart)
history/daily/<slug>.csv   one aggregated row per day, kept indefinitely
history/state.json         current status and open issue per monitor
history/incidents.json     snapshot of recent incident issues
```

Issues labelled with the incident label show up on the page, so you can also
open one by hand for planned work; add a `maintenance` label to mark it as such.

## Local preview

```bash
export CONFIG_VARS='{"SITE_TITLE":"Status","MONITOR_WEBSITE":"https://example.com"}'
node scripts/check.mjs
node scripts/build.mjs
npx serve _site
```

`CONFIG_VARS` is the JSON object that the workflows pass in from the Actions
`vars` context. `scripts/incidents.mjs` additionally needs `GITHUB_TOKEN` and
`GITHUB_REPOSITORY`.

## Notes

- Scheduled workflows are queued, not guaranteed: runs drift by several minutes
  under load, and GitHub disables schedules in repositories with no activity for
  60 days.
- Uptime percentages count degraded checks as up; the day tooltip shows the
  share of successful checks.
- Checks run from GitHub's runners, so they only see outages that are visible
  from the public internet.
