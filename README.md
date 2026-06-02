# Unifize Test Runner

A native macOS desktop app for running Playwright tests on the Unifize platform — no terminal knowledge required.

---

## Features

- 🖥 **Native macOS app** — installs like any `.app`, lives in your Applications folder
- 📁 **Repo picker on first launch** — prompts you to locate the `playwright-tests` folder, saves it for future runs
- 🔀 **Branch switcher** — fetch & hard-reset to upstream in one click (no merge conflicts)
- 🔍 **Universal search** — search folders and spec files by name in the same box (Step 3)
- ▶ **6-step wizard** — guided configuration for environment, branch, module, specs, browser mode, workers & retries
- ⌨ **Double-click to advance** — double-click any option at any step to select and jump forward instantly
- 📺 **Live terminal** — streams Playwright output in real time with ANSI colour support
- 📋 **Report viewer** — auto-finds and opens the latest Playwright HTML report in your browser
- 🔁 **Change Repo** — switch to a different repo folder anytime from the sidebar

---

## Requirements

These must already be installed on the machine **before** running the app:


| Dependency                  | Install                                  |
| --------------------------- | ---------------------------------------- |
| Node.js + npm               | [https://nodejs.org](https://nodejs.org) |
| Playwright                  | `npm install` inside the repo            |
| Git                         | Pre-installed on macOS                   |
| The `playwright-tests` repo | Cloned anywhere on your Mac              |


---

## Installation

1. Download the DMG for your Mac:
  - **Apple Silicon (M1/M2/M3):** `Unifize Test Runner-1.0.0-arm64.dmg`
  - **Intel Mac:** `Unifize Test Runner-1.0.0.dmg`
2. Open the DMG and drag **Unifize Test Runner** into your **Applications** folder.
3. On first launch, macOS Gatekeeper may block the app (unsigned build).
  To bypass: **right-click → Open → Open in Terminal** in the dialog.
4. Use Command  ```xattr -dr com.apple.quarantine "Unifize Test Runner.app```
5. On first launch, a folder picker appears — select your `playwright-tests` repo folder. The path is saved to `~/.unifize-test-runner.conf` and reused on every future launch.

---

## How to Use

### Run Tests

1. Click **Run Tests** from the sidebar or Home screen
2. Step through the 6-step wizard:


| Step                      | What you choose                                                      |
| ------------------------- | -------------------------------------------------------------------- |
| **1 — Environment**       | `Production` (app.unifize.com) or `Staging`                          |
| **2 — Branch**            | Switch branch + auto-sync from upstream                              |
| **3 — Module / Folder**   | Universal search — finds folders AND spec files                      |
| **4 — Spec Files**        | Multi-select specs (Cmd+click), or double-click to select & continue |
| **5 — Browser Mode**      | Headless / Headed / Debug (Playwright inspector)                     |
| **6 — Workers & Retries** | Parallel workers (1 / 2 / 4) and retry count (0 / 1 / 2)             |


1. Click **▶ Run Tests** — live output streams in the terminal panel
2. Click **Open Report →** to view the full HTML report in your browser

> **Tip:** Double-click any option at any step to select it and jump to the next step automatically.

---

### Pull / Switch Branch

Click **Git** in the sidebar to switch and sync any branch:

- Automatically stashes local changes before switching
- Fetches from upstream
- Hard-resets local branch to match upstream exactly — no merge conflicts

Available branches:

- `shenoy-CI-Branch`
- `Prasad-CI`
- `saransh-complete`
- Stay on current

---

### Universal Search (Step 3)

The search box in **Module / Folder** searches both folders and spec files simultaneously:


| What you type | What it finds                                                          |
| ------------- | ---------------------------------------------------------------------- |
| `login`       | Folders named `login` + any spec file with `login` in the name or path |
| `regression`  | All folders under `tests/regression`                                   |
| `inbox`       | Any folder or spec containing `inbox`                                  |


- **Single-click** a result → selects it
- **Double-click a folder** → selects it and advances to Spec Files (Step 4)
- **Double-click a spec file** → selects it and skips straight to Browser Mode (Step 5)

Each result shows a tag badge — `all`, `folder`, or `spec` — so you know what type it is.

---

### Open Report

Click **Report** in the sidebar to auto-find and open the latest Playwright HTML report. The app scans the `reports/` folder, skips empty runs, and opens the most recent completed run.

---

### Change Repo

The **Change Repo** button in the sidebar footer lets you re-pick the `playwright-tests` folder at any time. Useful when:

- The repo is cloned to a different location
- Sharing the app with another team member on a different machine

The new path is saved to `~/.unifize-test-runner.conf` immediately.

---

## Building from Source

```bash
# Navigate to the app source
cd ~/unifize-app

# Install dependencies
npm install

# Run in development mode
npm start

# Build standalone macOS DMG
npm run build
```

Built DMGs are output to `dist/`:

- `Unifize Test Runner-1.0.0-arm64.dmg` — Apple Silicon
- `Unifize Test Runner-1.0.0.dmg` — Intel

---

## Project Structure

```
unifize-app/
├── main.js           # Electron main process
│                     #   — repo picker & config
│                     #   — git operations
│                     #   — spec discovery
│                     #   — test runner (npx playwright)
│                     #   — report finder & count parser
├── preload.js        # Secure IPC bridge between main and renderer
├── renderer/
│   ├── index.html    # App UI structure
│   ├── styles.css    # Dark theme styles
│   └── app.js        # UI logic — wizard, search, terminal, summary, navigation
├── assets/
│   └── icon.icns     # macOS app icon
└── package.json      # App metadata + electron-builder config
```

---

## Repo Config File

The selected repo path is stored at:

```
~/.unifize-test-runner.conf
```

To reset and re-pick the folder, either:

- Click **Change Repo** in the sidebar, or
- Delete the file: `rm ~/.unifize-test-runner.conf` and relaunch the app

---

## Branches


| Branch             | Owner   |
| ------------------ | ------- |
| `shenoy-CI-Branch` | Shenoy  |
| `Prasad-CI`        | Prasad  |
| `saransh-complete` | Saransh |


---

## Notes

- The app is **completely independent** of the shell script (`unifize-test-runner.sh`). Both do the same job — the Electron app is the GUI replacement.
- The app lives at `~/unifize-app/` — **outside** the git repo — so branch switches in the repo never affect the app files.
- Since the app is unsigned (no Apple Developer certificate), you may see a Gatekeeper warning on first launch. Right-click → Open to bypass it once — it won't ask again.
- On first run, macOS may ask for keychain access for git credentials — click **Always Allow** so it doesn't prompt again.

