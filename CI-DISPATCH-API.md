# CI Dispatch — GitHub API (Reference)

Every call `unifize-app` needs to trigger and monitor a run. Companion to
`CI-DISPATCH-PLAN.md`; applies to auth strategy **A** or **C** only (**B** —
push-triggered — needs none of this).

Base `https://api.github.com`; `{o}/{r}` = `prasadhelaskar-unifize/playwright-tests`.
The fork is **private** — unauthenticated calls return 404, including status polling.

## Common headers
```
Authorization: Bearer <token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
User-Agent: unifize-test-runner
```
`User-Agent` is **not optional** — GitHub rejects requests without one.

## Calls
| # | Phase | Call | Returns |
|---|---|---|---|
| 1 | settings | `GET /repos/{o}/{r}` | 200 + `permissions` — validates token *and* access in one shot |
| 2 | dispatch | `POST /repos/{o}/{r}/actions/workflows/app-dispatch.yml/dispatches` | **204, empty body** |
| 3 | dispatch | `GET /…/workflows/app-dispatch.yml/runs?event=workflow_dispatch&per_page=20` | run list — match `run_tag` |
| 4 | monitor | `GET /repos/{o}/{r}/actions/runs/{run_id}` | `status`, `conclusion`, `html_url` |
| 5 | monitor | `GET /repos/{o}/{r}/actions/runs/{run_id}/jobs` | `jobs[].steps[]` — the step tracker |
| 6 | stop | `POST /repos/{o}/{r}/actions/runs/{run_id}/cancel` | 202 |
| 7 | results | `GET /repos/{o}/{r}/actions/runs/{run_id}/artifacts` | `id`, `name`, `size_in_bytes`, `expired` |
| 8 | results | `GET /repos/{o}/{r}/actions/artifacts/{artifact_id}/zip` | **302** to a pre-signed URL |

Optional: `GET /rate_limit` (free, uncounted); `GET /…/runs/{run_id}/logs` (302 to a zip,
only useful once the run completes).

## Sharp edges
| Call | Edge |
|---|---|
| #2 | Returns **no run ID**. Filename `app-dispatch.yml` works in place of a numeric workflow ID. `ref` is `main` — the branch rides in `inputs`. All input values must be **strings**. |
| #3 | The run does **not** exist instantly — poll every 2s for up to ~30s. Match `run_tag` against `display_title` (where `run-name:` lands). Narrow with `&created=>{dispatch ISO timestamp}`. |
| #6 | **Async.** 202 is not confirmation — the run stays `in_progress` for a few seconds. Let the next #4 confirm. |
| #8 | **Drop `Authorization` when following the 302** — see *Do NOT* in the plan. Artifacts only exist after the upload step finishes; expect an empty list mid-run. |

## Implementation shape
Slots into the existing `postToSlack` pattern in `main.js` — raw `https`, **no new dependency**:

```js
function gh(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path, method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'unifize-test-runner',
        ...(data && { 'Content-Type': 'application/json',
                      'Content-Length': Buffer.byteLength(data) })
      }
    }, res => {
      let out = '';
      res.on('data', d => out += d);
      res.on('end', () => resolve({
        status: res.statusCode,
        location: res.headers.location,        // #8
        body: out ? JSON.parse(out) : null     // #2 returns empty
      }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
```

## Token permissions
Fine-grained PAT, scoped to the one repo:

| Permission | Level | For |
|---|---|---|
| Actions | Read + Write | #2, #6 write; #3, #4, #5, #7, #8 read |
| Metadata | Read | implicit, auto-enabled |
| Contents | Read + Write | **only** for branch-sync-on-dispatch — drop it if branches are pre-pushed |

Budget: 5,000 req/hr per user. Monitoring is #4 + #5 every 5s ≈ **1,440/hr** during an
active run. Back off while a run is queued rather than executing.
