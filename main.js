const { app, BrowserWindow, ipcMain, Notification, shell, dialog: electronDialog } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const UPSTREAM_URL = 'https://github.com/unifize/playwright-tests.git';
const CONFIG_FILE  = path.join(os.homedir(), '.unifize-test-runner.conf');

// ── FIX 1: Branch name allowlist — prevents command injection ─
const VALID_BRANCH = /^[a-zA-Z0-9._\-/]+$/;
function safeBranch(branch) {
  if (typeof branch !== 'string' || !VALID_BRANCH.test(branch)) {
    throw new Error(`Invalid branch name: ${branch}`);
  }
  return branch;
}

// ── FIX 3: Path must stay inside REPO_DIR ─────────────────────
function safeRepoPath(p) {
  const resolved = path.resolve(p);
  const repoReal = fs.realpathSync(REPO_DIR);
  if (!resolved.startsWith(repoReal + path.sep) && resolved !== repoReal) {
    throw new Error(`Path outside repo: ${p}`);
  }
  return resolved;
}

let mainWindow;
let REPO_DIR = '';

// ── Repo picker ───────────────────────────────────────────────
function loadRepoDir() {
  if (fs.existsSync(CONFIG_FILE)) {
    const saved = fs.readFileSync(CONFIG_FILE, 'utf8').trim();
    if (saved && isValidRepo(saved)) { REPO_DIR = saved; return true; }
  }
  return false;
}

function isValidRepo(dir) {
  return fs.existsSync(path.join(dir, 'playwright.config.js')) &&
         fs.existsSync(path.join(dir, 'tests'));
}

function saveRepoDir(dir) {
  fs.writeFileSync(CONFIG_FILE, dir, 'utf8');
  REPO_DIR = dir;
}

async function askForRepoDir() {
  while (true) {
    const result = await electronDialog.showOpenDialog(mainWindow, {
      title: 'Select your playwright-tests repo folder',
      message: 'Locate the playwright-tests repository folder',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths.length) { app.quit(); return false; }
    const chosen = result.filePaths[0];
    if (!isValidRepo(chosen)) {
      await electronDialog.showMessageBox(mainWindow, {
        type: 'error', title: 'Wrong Folder',
        message: 'That doesn\'t look like the playwright-tests repo.\n\nplaywright.config.js or tests/ folder not found.\n\nPlease select the correct folder.',
        buttons: ['Try Again']
      });
      continue;
    }
    saveRepoDir(chosen);
    return true;
  }
}

// ── PATH resolution for packaged .app ────────────────────────
function resolveEnv() {
  const extraPaths = ['/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/bin', '/bin'].join(':');
  return { ...process.env, PATH: `${extraPaths}:${process.env.PATH || ''}` };
}

function findBin(name) {
  for (const dir of ['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin', `${os.homedir()}/.nvm/current/bin`]) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return name;
}

function ensureUpstream() {
  try { execSync('git remote get-url upstream', { cwd: REPO_DIR, stdio: 'ignore' }); }
  catch { try { execSync('git remote add upstream ' + UPSTREAM_URL, { cwd: REPO_DIR }); } catch {} }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900, height: 680, minWidth: 780, minHeight: 560,
    titleBarStyle: 'hiddenInset', backgroundColor: '#0f1117',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  createWindow();
  if (!loadRepoDir()) { const ok = await askForRepoDir(); if (!ok) return; }
  ensureUpstream();
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('repo:ready', REPO_DIR);
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── IPC — Repo ────────────────────────────────────────────────
ipcMain.handle('repo:get', () => REPO_DIR);
ipcMain.handle('repo:change', async () => {
  const ok = await askForRepoDir();
  if (ok) ensureUpstream();
  return ok ? REPO_DIR : null;
});

// ── IPC — Git ─────────────────────────────────────────────────
ipcMain.handle('git:current-branch', () => {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_DIR }).toString().trim(); }
  catch { return 'unknown'; }
});

ipcMain.handle('git:switch', async (_, branch) => {
  // FIX 1: Validate branch name, then use spawn args array (no bash -c interpolation)
  try { safeBranch(branch); } catch (e) { return { ok: false, output: e.message }; }

  return new Promise(resolve => {
    let out = '';
    const collect = d => { out += d.toString(); };
    const env = resolveEnv();
    const git = findBin('git');

    // Step 1: stash
    const stash = spawn(git, ['stash', '--include-untracked'], { cwd: REPO_DIR, env });
    stash.stdout.on('data', collect);
    stash.stderr.on('data', collect);
    stash.on('close', () => {
      // Step 2: fetch
      const fetch = spawn(git, ['fetch', 'upstream', branch], { cwd: REPO_DIR, env });
      fetch.stdout.on('data', collect);
      fetch.stderr.on('data', collect);
      fetch.on('close', fetchCode => {
        if (fetchCode !== 0) { return resolve({ ok: false, output: out }); }
        // Step 3: checkout -B
        const checkout = spawn(git, ['checkout', '-B', branch, `upstream/${branch}`], { cwd: REPO_DIR, env });
        checkout.stdout.on('data', collect);
        checkout.stderr.on('data', collect);
        checkout.on('close', coCode => {
          // Step 4: stash drop (best effort)
          spawn(git, ['stash', 'drop'], { cwd: REPO_DIR, env }).on('close', () => {
            resolve({ ok: coCode === 0, output: out });
          });
        });
      });
    });
  });
});

// ── IPC — Specs ───────────────────────────────────────────────
ipcMain.handle('specs:all', () => {
  const testsDir = path.join(REPO_DIR, 'tests');
  if (!fs.existsSync(testsDir)) return [];
  const results = [];
  const repoReal = fs.realpathSync(REPO_DIR);

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      // FIX 4: Resolve symlinks, skip anything outside repo
      let real;
      try { real = fs.realpathSync(full); } catch { continue; }
      if (!real.startsWith(repoReal)) continue;

      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.spec.js')) {
        const relPath = path.relative(REPO_DIR, full);
        const folder  = path.relative(REPO_DIR, dir);
        let count = 0;
        try { count = (fs.readFileSync(real, 'utf8').match(/^\s*test(\.(only|skip|fixme))?\s*\(/gm) || []).length; } catch {}
        results.push({ name: entry.name, path: relPath, folder, count });
      }
    }
  };
  walk(testsDir);
  return results.sort((a, b) => a.name.localeCompare(b.name));
});

ipcMain.handle('specs:folders', () => {
  const testsDir = path.join(REPO_DIR, 'tests');
  if (!fs.existsSync(testsDir)) return [];
  const folders = new Set();
  const repoReal = fs.realpathSync(REPO_DIR);

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      let real;
      try { real = fs.realpathSync(full); } catch { continue; }
      if (!real.startsWith(repoReal)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.spec.js')) folders.add(path.relative(REPO_DIR, dir));
    }
  };
  walk(testsDir);
  return [...folders].sort();
});

const VALID_REPORTERS = ['default', 'line', 'dot', 'list'];

// ── IPC — Tests ───────────────────────────────────────────────
let runningProc = null;
// ── IPC — Test cases ──────────────────────────────────────────
ipcMain.handle('specs:tests', (_, specPaths) => {
  if (!Array.isArray(specPaths)) return [];
  const results = [];
  for (const relPath of specPaths) {
    let safePath;
    try { safePath = safeRepoPath(path.join(REPO_DIR, relPath)); } catch { continue; }
    if (!fs.existsSync(safePath)) continue;
    let content;
    try { content = fs.readFileSync(safePath, 'utf8'); } catch { continue; }
    const tests = [];
    // Match test[.modifier]('name', ...) and test[.modifier]("name", ...)
    const re = /^\s*test(\.(skip|fixme|only|fail))?\s*\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/gm;
    let m;
    while ((m = re.exec(content)) !== null) {
      const modifier = m[2] || null;
      const name = (m[3] ?? m[4] ?? '').replace(/\\(['"])/g, '$1');
      if (name) tests.push({ name, modifier });
    }
    results.push({ specPath: relPath, tests });
  }
  return results;
});

ipcMain.handle('tests:run', (_, { specPaths, env, headed, debug, workers, retries, reporter, grep, pdfFlag }) => {
  // Validate each spec path is inside repo
  const safeSpecs = specPaths.map(p => {
    try { return path.relative(REPO_DIR, safeRepoPath(path.join(REPO_DIR, p))); }
    catch { return null; }
  }).filter(Boolean);

  const safeReporter = VALID_REPORTERS.includes(reporter) ? reporter : 'default';

  const npxArgs = ['playwright', 'test', ...safeSpecs];
  if (headed || debug) npxArgs.push('--headed');
  if (debug) npxArgs.push('--debug');
  npxArgs.push(`--workers=${parseInt(workers) || 2}`);
  npxArgs.push(`--retries=${parseInt(retries) || 0}`);
  if (grep && typeof grep === 'string' && grep.length > 0 && grep.length < 5000) {
    npxArgs.push('--grep', grep);
  }

  const envVars = {
    ...resolveEnv(),
    PLAYWRIGHT_ENV: typeof env === 'string' ? env : 'prod',
    EXECUTION_SETTINGS: '1',
    HEADLESS: headed || debug ? 'false' : 'true',
    WORKERS: String(parseInt(workers) || 2),
    RETRIES: String(parseInt(retries) || 0)
  };
  if (pdfFlag === 'STITCH_PDF')      envVars.STITCH_PDF      = '1';
  else if (pdfFlag === 'STITCH_PDF_ONLY') envVars.STITCH_PDF_ONLY = '1';
  else if (pdfFlag === 'HIGHLIGHT_ONLY')  envVars.HIGHLIGHT_ONLY  = '1';

  const npx = findBin('npx');
  const caffeinate = findBin('caffeinate');

  // Wrap with caffeinate -i to prevent Mac sleep during long runs
  const [cmd, args] = caffeinate !== 'caffeinate'
    ? [caffeinate, ['-i', npx, ...npxArgs]]
    : [npx, npxArgs];

  // detached: true creates a new process group so we can kill the whole tree
  runningProc = spawn(cmd, args, { cwd: REPO_DIR, env: envVars, detached: true });
  runningProc.stdout.on('data', d => mainWindow?.webContents.send('tests:output', d.toString()));
  runningProc.stderr.on('data', d => mainWindow?.webContents.send('tests:output', d.toString()));
  runningProc.on('close', code => { runningProc = null; mainWindow?.webContents.send('tests:done', { exitCode: code }); });
  runningProc.unref(); // don't block the app from quitting
  return { started: true };
});

ipcMain.handle('tests:stop', () => {
  if (!runningProc) return;

  const rootPid = runningProc.pid;
  runningProc = null;

  // Find all descendant PIDs of our root process, then SIGKILL them all.
  // This only kills children of OUR process — never touches Chrome, other Node, etc.
  try {
    // pgrep -P <pid> returns direct children; we walk the tree recursively
    const getAllDescendants = (pid) => {
      try {
        const { spawnSync } = require('child_process');
        const result = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' });
        const children = (result.stdout || '').trim().split('\n').filter(Boolean).map(Number);
        let all = [...children];
        for (const child of children) {
          all = all.concat(getAllDescendants(child));
        }
        return all;
      } catch { return []; }
    };

    const descendants = getAllDescendants(rootPid);
    const allPids = [rootPid, ...descendants];

    // Kill all with SIGKILL — our process tree only
    for (const pid of allPids) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }

    // Also kill the process group as a safety net
    try { process.kill(-rootPid, 'SIGKILL'); } catch {}

  } catch {}
});

// ── IPC — Reports ─────────────────────────────────────────────
ipcMain.handle('report:find', () => {
  const base = path.join(REPO_DIR, 'reports');
  if (!fs.existsSync(base)) return null;
  const dates = fs.readdirSync(base).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  for (const d of dates) {
    const runs = fs.readdirSync(path.join(base, d)).filter(r => /^run_\d+$/.test(r))
      .sort((a, b) => parseInt(b.split('_')[1]) - parseInt(a.split('_')[1]));
    for (const r of runs) {
      const html = path.join(base, d, r, 'playwright-report', 'index.html');
      if (fs.existsSync(html)) return html;
    }
  }
  return null;
});

ipcMain.handle('report:open', (_, p) => {
  // FIX 3: Only open paths inside REPO_DIR
  try {
    const safe = safeRepoPath(p);
    return shell.openPath(safe);
  } catch (e) {
    console.error('report:open blocked:', e.message);
  }
});

ipcMain.handle('report:counts', () => {
  const base = path.join(REPO_DIR, 'reports');
  if (!fs.existsSync(base)) return null;
  const dates = fs.readdirSync(base).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  for (const d of dates) {
    const runs = fs.readdirSync(path.join(base, d)).filter(r => /^run_\d+$/.test(r))
      .sort((a, b) => parseInt(b.split('_')[1]) - parseInt(a.split('_')[1]));
    for (const r of runs) {
      const dataDir = path.join(base, d, r, 'playwright-report', 'data');
      if (!fs.existsSync(dataDir)) continue;
      let passed = 0, failed = 0, skipped = 0, flaky = 0;
      for (const file of fs.readdirSync(dataDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const json = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
          for (const t of (json.tests || [])) {
            const last = t.results?.[t.results.length - 1];
            if (!last) continue;
            if (t.outcome === 'flaky') flaky++;
            else if (last.status === 'passed') passed++;
            else if (last.status === 'failed' || last.status === 'timedOut') failed++;
            else if (last.status === 'skipped') skipped++;
          }
        } catch {}
      }
      const total = passed + failed + skipped + flaky;
      if (total > 0) return { passed, failed, skipped, flaky, total };
    }
  }
  return null;
});

// FIX 2: Safe ANSI→HTML conversion in main process using ansi-to-html
const AnsiToHtml = require('ansi-to-html');
const ansiConverter = new AnsiToHtml({ escapeXML: true });
ipcMain.handle('ansi:convert', (_, raw) => {
  if (typeof raw !== 'string') return '';
  try { return ansiConverter.toHtml(raw); }
  catch { return raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
});

ipcMain.handle('notify', (_, { title, body }) => {
  // FIX 5: Sanitise notification strings
  if (typeof title !== 'string' || typeof body !== 'string') return;
  new Notification({ title: title.slice(0, 100), body: body.slice(0, 200) }).show();
});
