# CI Dispatch from Test Runner (Plan)

Run the app's 7-step wizard selection (env, branch, specs, test cases, workers,
retries, flags) on GitHub Actions instead of the user's laptop. This is that plan —
**proposed**, pending approval before code lands (touches **both repos**: one new
workflow in `playwright-tests`, ~5 new files in `unifize-app`). API detail lives in
`CI-DISPATCH-API.md`.

## Current state
`playwright-tests` has 5 workflows. `localRun.yml` is already `workflow_dispatch`, but
its only input is `playwright_env` — specs are a hardcoded 9-module matrix.
`unifize-app` spawns `npx playwright test` locally; no GitHub integration at all.

Two facts that make this cheap:
- `support/envs/env*` are **committed** — CI needs no login secrets, only `TESTOMATIO`.
- `playwright.config.js` already reads `EXECUTION_SETTINGS` / `HEADLESS` / `WORKERS` /
  `RETRIES` / `PLAYWRIGHT_ENV`, and the `json` reporter already writes `results.json`.

## Decisions
| Question | Choice | Why |
|---|---|---|
| Target repo | fork `prasadhelaskar-unifize/playwright-tests` | isolated minutes; owner/repo in settings so upstream is a config flip, not a rebuild |
| Execution | single job, `WORKERS` passed through | 1:1 with local semantics; one artifact; trivial monitor view |
| Auth | **open** — see *Auth strategy* | |

## Proposed `app-dispatch.yml` inputs
8 of the 10 allowed. All values must be **strings** — `"workers": 2` is rejected.

| Input | Wizard source | Notes |
|---|---|---|
| `branch` | Step 2 | passed to `actions/checkout`, **not** the dispatch ref |
| `playwright_env` | Step 1 | repo also supports `govcloud`, `preprod`, `shadow` |
| `specs` | Steps 3–4 | space-joined relative paths |
| `grep` | Step 5 | regex alternation from selected titles; often empty |
| `workers`, `retries` | Step 7 | straight through |
| `proof_flags` | Step 7 | **remap needed** — see *Known bugs* |
| `run_tag` | generated | correlation only; surfaces via `run-name:` |

## Auth strategy (chosen at execution time)
GitHub has no anonymous trigger, and the fork is **private** — even status polling needs
a credential. The app already depends on working git credentials (`credential.helper =
osxkeychain`, Branch switcher runs `git fetch upstream`), which is what makes B free.

- **A — Per-user PAT in Keychain:** fine-grained PAT, Actions RW, stored via Electron
  `safeStorage` (Keychain-backed; avoids the unmaintained `keytar` native dep). Gives
  attribution and per-person revocation. Cost: every user does a one-time setup.
- **B — Push-triggered, no API token:** app pushes a `ci-run/<tag>` ref using existing
  git credentials; a `push:` workflow picks it up. **Zero setup for non-technical
  users.** Cost: no in-app monitoring (open the run in the browser, where their session
  already authenticates), and run refs need periodic cleanup.
- **C — Hardcoded shared PAT:** zero setup, but the secret ships in the DMG —
  `npx asar extract-file … .env` already recovers the Slack webhook this way. Viable
  **only** as Actions RW on the one repo, **no `Contents`**, private-repo distribution,
  and a rotation reminder (fine-grained PATs cap at 1 year; rotating = rebuild + redeploy
  to every user). A leak then reads run artifacts — which are screenshots and video of a
  logged-in production session, since the config sets `screenshot: 'on'` / `video: 'on'`.

**Recommendation:** B — it hits the actual goal (nothing for the user to set up) with no
secret to rotate or leak. Choose A instead if the in-app monitor view is the point of the
feature; C only with the scoping above.

## Phases
| # | Deliverable | Gate |
|---|---|---|
| 0 | Enable Actions on the fork; add `TESTOMATIO` secret | manual, ~15 min |
| 1 | `app-dispatch.yml` in `playwright-tests` | **testable from the GitHub UI alone — no app changes** |
| 2 | Token storage + `gh()` client in `main.js` (skip if B) | "Test connection" passes |
| 3 | Wizard *Run on: This Mac / GitHub CI* toggle + dispatch | Step 6 greys out — no display on a runner |
| 4 | Monitor view: poll run + jobs, Stop → cancel | no live logs; step tracker replaces the terminal |
| 5 | Artifact → `results.json` → existing summary bar + Slack | counts map onto `renderSummaryBar` unchanged |
| 6 | Token expiry, offline, rate limit, in-flight guard | — |

Phase 1 alone is useful: user-selected specs on CI via the GitHub UI, before the app
knows anything about it.

## Fork branch gap
Only **1 of 5** branches the app offers exists on the fork (`Prasad-CI`;
`shenoy-CI-Branch`, `saransh-complete`, `varun-ci`, `Validation-Prasad` are upstream-only).
Either pre-push the four by hand (they drift), or have Step 2 follow its existing
`git fetch upstream <branch>` with `git push origin <branch>` before dispatch — needs
`Contents: write` on the token.

## Known bugs (fix before Phase 3)
- **PDF flags are already dead.** App sends `STITCH_PDF` / `STITCH_PDF_ONLY` /
  `HIGHLIGHT_ONLY`; none of those strings exist on `origin/main`, `origin/Prasad-CI`, or
  `origin/unified-Branch`. Real flags are `HIGHLIGHT=1`, `PDF=1`, `VIDEO_PROOF=1`
  (`support/utils/proof-pack-flags.js`). Remap, or the same no-op ships twice.
- **`report:open` is locked to `REPO_DIR`** (`main.js:398`) — it will refuse to open a
  downloaded CI report until a second allowed root under `userData` is added.

## Do NOT
- **Do NOT dispatch at the test branch.** To dispatch workflow `X` at ref `Y`, `X` must
  exist on `Y` — with 20+ branches that means merging the workflow forever. Dispatch at
  `main`; pass the branch as an input and `actions/checkout` it.
- **Do NOT interpolate `${{ inputs.specs }}` or `${{ inputs.grep }}` inside `run:`.**
  `buildGrepPattern()` (`renderer/app.js:846`) regex-escapes test titles, so the pattern
  is full of backslashes and quotes — that is shell injection. Bind to `env:`, quote as
  `"$SPECS"` / `"$GREP"`.
- **Do NOT forward the token to the artifact redirect.** `…/artifacts/{id}/zip` 302s to a
  pre-signed blob URL; drop `Authorization` when following, or the PAT leaks to a
  third-party host (and the storage backend rejects it anyway).
- **Do NOT upload one fat artifact.** `video: 'on'` + `screenshot: 'on'` means hundreds of
  MB per run. Split: `results.json` + `playwright-report/` always; `test-results/` on demand.

## Trade-off to state plainly
CI mode is a **strictly worse interactive experience** — no live output, ~2–4 min of
runner setup before the first test, no headed or debug mode. It buys runs that survive
closing the laptop, no local Node/Playwright setup, consistent Linux+Chromium results,
and shareable run URLs. Say so up front so nobody expects the terminal panel to work.
