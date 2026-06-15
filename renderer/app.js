/* ════════════════════════════════════════════════════════
   Unifize Test Runner — Renderer
   ════════════════════════════════════════════════════════ */

// ── Execution state ───────────────────────────────────────
let isRunning      = false;

// ── Progress tracking state ───────────────────────────────
let progressTotal  = 0;   // total tests expected (from scan or Playwright announce)
let progressDone   = 0;   // tests completed (pass + fail + skip)
let progressFailed = 0;   // tests that failed
let specTrackerMap = {};  // relPath → 'pending'|'running'|'passed'|'failed'
let outputLineBuf  = '';  // buffer for incomplete output lines
// 'standard' = using ✓/✗ lines; 'trace' = using [trace-screenshot-reporter];
// null = not yet decided. Standard takes priority to avoid double-counting.
let progressMode   = null;

function setRunning(val) {
  isRunning = val;
  const runNav = document.querySelector('.nav-item[data-view="run"]');
  runNav.classList.toggle('running', val);
}

// ── Theme (day / night) ───────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const isLight = theme === 'light';
  const icon = document.getElementById('themeToggleIcon');
  const label = document.getElementById('themeToggleLabel');
  if (icon) icon.textContent = isLight ? '☀️' : '🌙';
  if (label) label.textContent = isLight ? 'Day' : 'Night';
  try { localStorage.setItem('theme', theme); } catch (_) {}
}
(function initTheme() {
  let saved;
  try { saved = localStorage.getItem('theme'); } catch (_) {}
  applyTheme(saved === 'dark' ? 'dark' : 'light');
})();
document.getElementById('themeToggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'light' ? 'dark' : 'light');
});

// ── Navigation ────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn =>
  btn.addEventListener('click', () => handleNavClick(btn.dataset.view))
);
document.querySelectorAll('[data-goto]').forEach(el =>
  el.addEventListener('click', () => showView(el.dataset.goto))
);

function handleNavClick(viewId) {
  if (isRunning && viewId !== 'run') {
    showRunningWarning(viewId);
    return;
  }
  showView(viewId);
}

function showRunningWarning(targetView) {
  const banner = document.getElementById('running-warning');
  banner.style.display = 'flex';
  banner.dataset.target = targetView;
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => { banner.style.display = 'none'; }, 6000);
}

// Warning banner buttons
document.getElementById('warn-leave').addEventListener('click', () => {
  const banner = document.getElementById('running-warning');
  const target = banner.dataset.target;
  banner.style.display = 'none';
  showView(target);
});
document.getElementById('warn-stay').addEventListener('click', () => {
  document.getElementById('running-warning').style.display = 'none';
  showView('run');
});

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${id}`));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === id));
  if (id === 'report') loadReport();
}

// ── Repo path display ─────────────────────────────────────
async function refreshRepoPath() {
  const p = await window.api.repo.get();
  if (p) {
    document.getElementById('repoPath').textContent = `📁 ${p.split('/').pop()}`;
    document.getElementById('repoPath').title = p;
  }
}
refreshRepoPath();

window.api.repo.onReady(p => {
  document.getElementById('repoPath').textContent = `📁 ${p.split('/').pop()}`;
  document.getElementById('repoPath').title = p;
});

document.getElementById('changeRepo').addEventListener('click', async () => {
  const newPath = await window.api.repo.change();
  if (newPath) {
    document.getElementById('repoPath').textContent = `📁 ${newPath.split('/').pop()}`;
    document.getElementById('repoPath').title = newPath;
    await preloadData();
    refreshBranch();
  }
});

// ── Branch badge ──────────────────────────────────────────
async function refreshBranch() {
  const b = await window.api.git.currentBranch();
  document.getElementById('currentBranch').textContent = `⎇ ${b}`;
  document.getElementById('step2-current').textContent = `current: ${b}`;
  document.getElementById('stay-label').textContent = b;
  document.querySelectorAll('.branch-row').forEach(r =>
    r.querySelector('.branch-arrow').textContent = r.dataset.branch === b ? '✓' : '→'
  );
}
refreshBranch();

// ── Option groups ─────────────────────────────────────────
function bindOptionGroup(groupId, onDblClick) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    btn.addEventListener('dblclick', () => {
      group.querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      btn.classList.add('dblclick-flash');
      if (onDblClick) setTimeout(onDblClick, 180);
    });
  });
}
function getSelected(groupId) {
  return document.getElementById(groupId)?.querySelector('.option-btn.active')?.dataset.value ?? null;
}

bindOptionGroup('env-options',      () => showStep(2));
bindOptionGroup('browser-options',  () => showStep(6));
bindOptionGroup('worker-options',   () => document.getElementById('run-btn').click());
bindOptionGroup('retry-options',    () => document.getElementById('run-btn').click());
bindOptionGroup('branch-options',   () => document.getElementById('branch-next').click());

// ── Wizard state ──────────────────────────────────────────
let skipSpecStep    = false;
let allSpecs        = [];
let allFolders      = [];
let selectedFolder  = '';
let selectedFolders = new Set(); // multi-folder selection
let directSpecPath  = null;

function showStep(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById(`step-${n}`)?.classList.add('active');
  if (n === 3) setTimeout(() => document.getElementById('folder-search')?.focus(), 50);
  if (n === 4) setTimeout(() => document.getElementById('spec-search')?.focus(), 50);
}

function showWizard() {
  document.getElementById('wizard').style.display = 'block';
  document.getElementById('terminal-panel').style.display = 'none';
  document.getElementById('progress-strip').style.display = 'none';
  document.getElementById('spec-tracker').style.display   = 'none';
  selectedFolders.clear();
  updateFolderSelectionBadge();
  showStep(1);
}
showWizard();

// ── Step 1 ────────────────────────────────────────────────
document.getElementById('env-next').addEventListener('click', () => showStep(2));

// ── Step 2 ────────────────────────────────────────────────
document.getElementById('branch-next').addEventListener('click', async () => {
  const choice = getSelected('branch-options');
  if (!choice) return;
  const status = document.getElementById('branch-status');
  if (choice === '__current__') { await preloadData(); showStep(3); return; }
  status.textContent = `Fetching upstream/${choice}…`;
  status.style.color = 'var(--muted)';
  const result = await window.api.git.switchBranch(choice);
  if (result.ok) {
    status.textContent = `✓ Switched to ${choice}`;
    status.style.color = 'var(--green)';
    refreshBranch();
    setTimeout(async () => { status.textContent = ''; await preloadData(); showStep(3); }, 800);
  } else {
    status.textContent = `✗ Failed: ${result.output.split('\n')[0]}`;
    status.style.color = 'var(--red)';
  }
});
document.getElementById('branch-back').addEventListener('click', () => showStep(1));

// ── Preload ───────────────────────────────────────────────
async function preloadData() {
  [allFolders, allSpecs] = await Promise.all([
    window.api.specs.folders(),
    window.api.specs.all()
  ]);
  resetFolderSearch();
}
preloadData();

// ── Step 3: Universal search ──────────────────────────────
const PINNED = [
  { label: 'ALL Tests',      path: 'tests/',           isAll: true },
  { label: 'All Regression', path: 'tests/regression', isAll: true },
  { label: 'All Smoke',      path: 'tests/Smoke',      isAll: true },
];

function resetFolderSearch() {
  const si = document.getElementById('folder-search');
  if (si) si.value = '';
  document.getElementById('folder-search-clear').style.display = 'none';
  selectedFolders.clear();
  updateFolderSelectionBadge();
  renderUniversalSearch('');
}

function renderUniversalSearch(query) {
  const list = document.getElementById('folder-list');
  list.innerHTML = '';
  const q = query.trim().toLowerCase();

  if (!q) {
    renderSectionLabel(list, 'Quick Select');
    PINNED.forEach(p => addFolderRow(list, p.label, p.path, p.path, true, false, ''));

    const dynamic = allFolders.filter(f => !['tests/', 'tests/regression', 'tests/Smoke'].includes(f));
    if (dynamic.length) {
      renderSectionLabel(list, 'Folders');
      dynamic.forEach(f => addFolderRow(list, f.split('/').pop(), f, f, false, false, ''));
    }
    return;
  }

  const matchedFolders = allFolders.filter(f =>
    f.toLowerCase().includes(q) || f.split('/').pop().toLowerCase().includes(q)
  );
  const matchedSpecs = allSpecs.filter(s =>
    s.name.toLowerCase().includes(q) || s.folder.toLowerCase().includes(q)
  );

  if (!matchedFolders.length && !matchedSpecs.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = `No folders or specs match "${query}"`;
    list.appendChild(empty);
    return;
  }

  if (matchedFolders.length) {
    renderSectionLabel(list, `Folders (${matchedFolders.length})`);
    matchedFolders.forEach(f => addFolderRow(list, f.split('/').pop(), f, f, false, false, q));
  }
  if (matchedSpecs.length) {
    renderSectionLabel(list, `Spec Files (${matchedSpecs.length})`);
    matchedSpecs.forEach(s => addFolderRow(list, s.name, s.path, s.folder, false, true, q, s.count));
  }
}

function renderSectionLabel(list, text) {
  const label = document.createElement('div');
  label.className = 'section-label';
  label.textContent = text;
  list.appendChild(label);
}

function updateFolderSelectionBadge() {
  const badge = document.getElementById('folder-selection-badge');
  if (!badge) return;
  const count = selectedFolders.size;
  if (count === 0) {
    badge.style.display = 'none';
  } else {
    badge.style.display = 'inline-flex';
    badge.textContent = `${count} folder${count > 1 ? 's' : ''} selected`;
  }
}

function addFolderRow(list, name, path, subtitle, isPinned, isSpec, query, count = null) {
  const row = document.createElement('div');
  const isSelected = !isSpec && selectedFolders.has(path);
  row.className = ['folder-item', isSelected ? 'selected' : '', isPinned ? 'pinned' : '', isSpec ? 'spec-result' : ''].filter(Boolean).join(' ');
  row.dataset.path   = path;
  row.dataset.isSpec = isSpec   ? 'true' : 'false';
  row.dataset.isAll  = isPinned ? 'true' : 'false';

  const icon = isSpec ? '📄' : isPinned ? '📁' : '🗂';
  row.innerHTML = `
    <div class="folder-item-left">
      <span class="folder-item-name">${icon} ${highlight(name, query)}</span>
      <span class="folder-item-path">${highlight(subtitle, query)}${count !== null ? ` · ${count} tests` : ''}</span>
    </div>
    <span class="folder-item-tag">${isSpec ? 'spec' : isPinned ? 'all' : 'folder'}</span>
  `;

  row.addEventListener('click', (e) => {
    if (isSpec) {
      // specs: single select only
      list.querySelectorAll('.folder-item').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      selectedFolders.clear();
      return;
    }

    if (e.metaKey || e.ctrlKey) {
      // Cmd+click: toggle this folder in multi-select
      // Pinned "ALL" items clear multi-select and act as single select
      if (isPinned) {
        selectedFolders.clear();
        list.querySelectorAll('.folder-item').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        selectedFolder = path;
      } else {
        if (selectedFolders.has(path)) {
          selectedFolders.delete(path);
          row.classList.remove('selected');
        } else {
          selectedFolders.add(path);
          row.classList.add('selected');
        }
      }
    } else {
      // Normal click: single select, clear others
      list.querySelectorAll('.folder-item').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      selectedFolders.clear();
      if (!isPinned) selectedFolders.add(path);
      selectedFolder = path;
    }
    updateFolderSelectionBadge();
  });

  row.addEventListener('dblclick', () => {
    list.querySelectorAll('.folder-item').forEach(r => r.classList.remove('selected'));
    row.classList.add('selected');
    row.classList.add('dblclick-flash');
    if (!isSpec && !isPinned) {
      selectedFolders.clear();
      selectedFolders.add(path);
    }
    if (!isSpec) selectedFolder = path;
    updateFolderSelectionBadge();
    setTimeout(() => handleFolderNext(path, isSpec, isPinned), 180);
  });

  list.appendChild(row);
}

// Folder search wiring
const folderSearch = document.getElementById('folder-search');
const folderClear  = document.getElementById('folder-search-clear');
folderSearch.addEventListener('input', () => {
  const q = folderSearch.value;
  folderClear.style.display = q ? 'block' : 'none';
  renderUniversalSearch(q);
});
folderClear.addEventListener('click', () => {
  folderSearch.value = '';
  folderClear.style.display = 'none';
  folderSearch.focus();
  renderUniversalSearch('');
});

function handleFolderNext(path, isSpec, isAll) {
  directSpecPath = null;

  // Direct spec pick from search
  if (isSpec) {
    directSpecPath = path;
    skipSpecStep = true;
    selectedFolder = path;
    showStep(5);
    return;
  }

  // Pinned ALL shortcuts → skip spec step
  if (isAll) {
    skipSpecStep = true;
    selectedFolder = path;
    selectedFolders.clear();
    showStep(5);
    return;
  }

  // Multi-folder or single folder → show spec list
  skipSpecStep = false;
  const foldersToLoad = selectedFolders.size > 0 ? [...selectedFolders] : [path];
  renderSpecList('', foldersToLoad);
  document.getElementById('spec-search').value = '';
  document.getElementById('spec-search-clear').style.display = 'none';
  showStep(4);
}

document.getElementById('folder-next').addEventListener('click', () => {
  const sel = document.querySelector('#folder-list .folder-item.selected');
  if (!sel) return;
  // If multiple folders selected, use them all
  if (selectedFolders.size > 1) {
    handleFolderNext(null, false, false);
    return;
  }
  handleFolderNext(sel.dataset.path, sel.dataset.isSpec === 'true', sel.dataset.isAll === 'true');
});
document.getElementById('folder-back').addEventListener('click', () => showStep(2));

// ── Step 4: Spec list + search ────────────────────────────
function renderSpecList(query, folderFilter) {
  const list = document.getElementById('spec-list');
  list.innerHTML = '';
  const q = query.trim().toLowerCase();

  // folderFilter can be a string or array of strings
  const folders = Array.isArray(folderFilter) ? folderFilter : (folderFilter ? [folderFilter] : []);
  const pool = folders.length > 0
    ? allSpecs.filter(s => folders.some(f => s.folder === f || s.folder.startsWith(f + '/')))
    : allSpecs;

  if (!q) {
    const label = folders.length > 1
      ? `📁 Run all ${folders.length} selected folders`
      : `📁 Run entire folder`;
    addSpecRow(list, folders.join(','), label, folders.join(', '), '', true, true, '');
  }

  const filtered = q
    ? pool.filter(s => s.name.toLowerCase().includes(q) || s.folder.toLowerCase().includes(q))
    : pool;

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = q ? `No specs match "${query}"` : 'No spec files found.';
    list.appendChild(empty);
    return;
  }
  filtered.forEach(s => addSpecRow(list, s.path, s.name, s.folder, `${s.count} tests`, false, false, q));
}

function addSpecRow(list, pathVal, name, folder, count, isFolder, defaultSelected, query) {
  const row = document.createElement('div');
  row.className = 'spec-item' + (defaultSelected ? ' selected' : '');
  row.dataset.path = pathVal;
  row.innerHTML = `
    <div class="spec-check"></div>
    <div class="spec-info">
      <span class="spec-name">${isFolder ? escapeHtml(name) : highlight(name, query)}</span>
      ${!isFolder ? `<span class="spec-parent">${highlight(folder, query)}</span>` : ''}
    </div>
    ${count ? `<span class="spec-count">${count}</span>` : ''}
  `;
  row.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey) { row.classList.toggle('selected'); }
    else { list.querySelectorAll('.spec-item').forEach(r => r.classList.remove('selected')); row.classList.add('selected'); }
  });
  row.addEventListener('dblclick', () => {
    list.querySelectorAll('.spec-item').forEach(r => r.classList.remove('selected'));
    row.classList.add('selected');
    row.classList.add('dblclick-flash');
    setTimeout(() => showStep(5), 200);
  });
  list.appendChild(row);
}

const specSearch = document.getElementById('spec-search');
const specClear  = document.getElementById('spec-search-clear');
specSearch.addEventListener('input', () => {
  const q = specSearch.value;
  specClear.style.display = q ? 'block' : 'none';
  renderSpecList(q, selectedFolder);
});
specClear.addEventListener('click', () => {
  specSearch.value = '';
  specClear.style.display = 'none';
  specSearch.focus();
  renderSpecList('', selectedFolder);
});

document.getElementById('spec-next').addEventListener('click', () => {
  if (!document.querySelector('#spec-list .spec-item.selected')) return;
  showStep(5);
});
document.getElementById('spec-back').addEventListener('click', () => { directSpecPath = null; showStep(3); });

// ── Step 5 ────────────────────────────────────────────────
document.getElementById('browser-next').addEventListener('click', () => showStep(6));
document.getElementById('browser-back').addEventListener('click', () =>
  (directSpecPath || skipSpecStep) ? showStep(3) : showStep(4)
);

// ── Step 6 ────────────────────────────────────────────────
document.getElementById('workers-back').addEventListener('click', () => showStep(5));

// ── Progress helpers ──────────────────────────────────────

/** Return all allSpecs entries that match a path (file or folder). */
function specsMatchingPath(pathVal) {
  if (pathVal.endsWith('.spec.js')) return allSpecs.filter(s => s.path === pathVal);
  const norm = pathVal.replace(/\/$/, '');   // remove trailing slash
  return allSpecs.filter(s =>
    s.folder === norm ||
    s.folder.startsWith(norm + '/') ||
    s.path.startsWith(norm + '/')
  );
}

/** Set up progress state for the run about to start. */
function initProgress(specPaths) {
  progressTotal  = 0;
  progressDone   = 0;
  progressFailed = 0;
  specTrackerMap = {};
  outputLineBuf  = '';
  progressMode   = null;

  for (const sp of specPaths) {
    for (const s of specsMatchingPath(sp)) {
      progressTotal += (s.count || 0);
      if (!(s.path in specTrackerMap)) specTrackerMap[s.path] = 'running'; // yellow pulse from start
    }
  }

  // Show spec chips only when ≤ 20 individual files are tracked
  const trackerEl = document.getElementById('spec-tracker');
  const count = Object.keys(specTrackerMap).length;
  if (count > 0 && count <= 20) {
    renderSpecTracker();
    trackerEl.style.display = 'flex';
  } else {
    trackerEl.style.display = 'none';
  }

  document.getElementById('progress-strip').style.display = 'flex';
  updateProgressUI();
}

/** Render spec chips from specTrackerMap. */
function renderSpecTracker() {
  const el = document.getElementById('spec-tracker');
  el.innerHTML = '';
  for (const [filePath, status] of Object.entries(specTrackerMap)) {
    const name = filePath.split('/').pop().replace('.spec.js', '');
    const chip = document.createElement('div');
    chip.className = `spec-chip ${status}`;
    chip.dataset.specPath = filePath;
    chip.title = filePath;
    chip.innerHTML = `<span class="spec-chip-dot"></span>${escapeHtml(name)}`;
    el.appendChild(chip);
  }
}

/** Update a single spec chip's visual state and scroll it to horizontal center. */
function updateSpecChip(specPath) {
  const chip = document.querySelector(`.spec-chip[data-spec-path="${CSS.escape(specPath)}"]`);
  if (!chip) return;
  chip.className = `spec-chip ${specTrackerMap[specPath] || 'pending'}`;

  // Scroll the tracker so this chip sits in the horizontal center
  const tracker = document.getElementById('spec-tracker');
  if (tracker) {
    const chipLeft   = chip.offsetLeft;
    const chipWidth  = chip.offsetWidth;
    const trackWidth = tracker.clientWidth;
    tracker.scrollTo({ left: chipLeft - (trackWidth / 2) + (chipWidth / 2), behavior: 'smooth' });
  }
}

/** Re-paint the progress bar and label. */
function updateProgressUI() {
  const fill  = document.getElementById('progress-bar-fill');
  const label = document.getElementById('progress-label');
  if (!fill || !label) return;

  const pct = progressTotal > 0 ? Math.min(Math.round((progressDone / progressTotal) * 100), 100) : 0;
  fill.style.width = `${pct}%`;
  fill.classList.toggle('failing', progressFailed > 0);

  const done = Math.min(progressDone, progressTotal);
  const parts = [`${done} / ${progressTotal} tests`];
  if (progressFailed > 0) parts.push(`${progressFailed} ✗`);
  parts.push(`${pct}%`);
  label.textContent = parts.join(' · ');
}

/** Parse one line of Playwright output for progress events. */
function parseProgressLine(line) {
  const clean = line.replace(/\x1b\[[^m]*m/g, '');  // strip ANSI

  // "Running 24 tests using 2 workers" — use Playwright's own total
  const totM = clean.match(/Running (\d+) tests? using/);
  if (totM) { progressTotal = parseInt(totM[1]); updateProgressUI(); return; }

  // ── Standard reporter result lines (✓ / ✗ / - per test) ─────────────────
  // Checked FIRST — if these appear, we lock into 'standard' mode and ignore
  // [trace-screenshot-reporter] lines to prevent double-counting.
  const specM = clean.match(/(tests\/[^\s:›·(]+\.spec\.js)/);
  if (specM) {
    const isPassed  = clean.includes('✓');
    const isFailed  = clean.includes('✗') || clean.includes('×') || clean.includes('✘');
    const isSkipped = !isPassed && !isFailed && /^\s*-\s+\d+/.test(clean);

    if (isPassed || isFailed || isSkipped) {
      progressMode = 'standard';   // lock: ignore trace lines from here on
      progressDone++;
      const specPath = specM[1].trim();
      if (isFailed) {
        progressFailed++;
        specTrackerMap[specPath] = 'failed';
      } else {
        if (specTrackerMap[specPath] !== 'failed') specTrackerMap[specPath] = 'running';
      }
      updateProgressUI();
      updateSpecChip(specPath);
      return;
    }
  }

  // ── Custom reporter: [test-progress] passed|failed|timedOut tests/foo.spec.js
  // Emitted by custom-reporter.js onTestEnd for every final test attempt.
  // Takes priority over [trace-screenshot-reporter] (which only fires on failure).
  const tpM = clean.match(/^\[test-progress\]\s+(passed|failed|timedOut|interrupted)\s+(tests\/[^\s]+\.spec\.js)/);
  if (tpM && progressMode !== 'standard') {
    progressMode = 'custom';
    progressDone = Math.min(progressDone + 1, progressTotal || Infinity);
    const tpStatus = tpM[1];
    const tpSpec   = tpM[2];
    if (tpStatus !== 'passed') {
      progressFailed++;
      specTrackerMap[tpSpec] = 'failed';
    } else {
      if (specTrackerMap[tpSpec] !== 'failed') specTrackerMap[tpSpec] = 'running';
    }
    updateProgressUI();
    updateSpecChip(tpSpec);
    return;
  }

  // ── [trace-screenshot-reporter] fallback (fires only on failure, retain-on-failure)
  // Used only when neither standard ✓/✗ nor [test-progress] lines appear.
  if (clean.startsWith('[trace-screenshot-reporter]') && progressMode !== 'standard' && progressMode !== 'custom') {
    progressMode = 'trace';
    progressDone = Math.min(progressDone + 1, progressTotal || Infinity);
    updateProgressUI();
    return;
  }

  // ── Playwright failure detail block: "  1) tests/foo/bar.spec.js:10:5 › ..."
  // Always parsed regardless of mode — marks individual spec chips as failed.
  const failDetailM = clean.match(/^\s+\d+\)\s+(tests\/[^\s:]+\.spec\.js)/);
  if (failDetailM) {
    const sp = failDetailM[1];
    if (sp in specTrackerMap) {
      specTrackerMap[sp] = 'failed';
      updateSpecChip(sp);
    }
  }
}

/** Feed a raw output chunk through the line-by-line parser. */
function processOutputChunk(chunk) {
  outputLineBuf += chunk;
  const lines = outputLineBuf.split('\n');
  outputLineBuf = lines.pop();           // keep incomplete trailing line
  for (const line of lines) parseProgressLine(line);
}

/** Finalise spec tracker after run ends: running → passed, hide bar on stop. */
function finaliseProgress(stopped = false) {
  if (stopped) {
    document.getElementById('progress-strip').style.display = 'none';
    document.getElementById('spec-tracker').style.display  = 'none';
    return;
  }
  // Flip all still-running chips to passed
  for (const path of Object.keys(specTrackerMap)) {
    if (specTrackerMap[path] === 'running') specTrackerMap[path] = 'passed';
  }
  renderSpecTracker();
  // Ensure bar reaches 100% if we got all tests
  if (progressDone >= progressTotal && progressTotal > 0) {
    const fill = document.getElementById('progress-bar-fill');
    if (fill) fill.style.width = '100%';
  }
  updateProgressUI();
}

// ── Run Tests ─────────────────────────────────────────────
document.getElementById('run-btn').addEventListener('click', async () => {
  const env     = getSelected('env-options')     || 'prod';
  const browser = getSelected('browser-options') || 'headless';
  const workers = parseInt(getSelected('worker-options') || '2');
  const retries = parseInt(getSelected('retry-options')  || '0');

  let specPaths = directSpecPath ? [directSpecPath]
    : skipSpecStep ? [selectedFolder]
    : [...document.querySelectorAll('#spec-list .spec-item.selected')].map(r => r.dataset.path);

  document.getElementById('wizard').style.display = 'none';
  document.getElementById('terminal-panel').style.display = 'flex';
  document.getElementById('terminal-footer').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'inline-block';
  document.getElementById('terminal-title').textContent =
    `Running — ${env} | ${specPaths.length} spec(s) | ${workers} worker(s)`;

  const output = document.getElementById('terminal-output');
  output.innerHTML = '';
  window.api.tests.offOutput();
  window.api.tests.offDone();

  // Initialise progress tracking for this run
  initProgress(specPaths);

  // Show the exact command being run
  const headed = browser !== 'headless';
  const debug  = browser === 'debug';
  const envLine = `PLAYWRIGHT_ENV=${env} EXECUTION_SETTINGS=1 HEADLESS=${headed ? 'false' : 'true'} WORKERS=${workers} RETRIES=${retries}`;
  const cmdParts = ['caffeinate -i npx playwright test', ...specPaths];
  if (headed || debug) cmdParts.push('--headed');
  if (debug) cmdParts.push('--debug');
  cmdParts.push(`--workers=${workers}`);
  cmdParts.push(`--retries=${retries}`);
  const cmdLine = cmdParts.join(' ');

  const cmdBlock = document.createElement('div');
  cmdBlock.className = 'cmd-preview';
  cmdBlock.innerHTML = `
    <div class="cmd-preview-label">▶ Command</div>
    <div class="cmd-preview-env">${escapeHtml(envLine)} \\</div>
    <div class="cmd-preview-cmd">${escapeHtml(cmdLine)}</div>
  `;
  output.appendChild(cmdBlock);

  let fullLog = '';

  window.api.tests.onOutput(async data => {
    fullLog += data;
    processOutputChunk(data);   // update progress bar + spec chips in real time
    const span = document.createElement('span');
    // FIX 2: Use safe ansi-to-html via main process (escapeXML: true)
    span.innerHTML = await window.api.ansi.convert(data);
    output.appendChild(span);
    output.scrollTop = output.scrollHeight;
  });

  window.api.tests.onDone(async ({ exitCode }) => {
    setRunning(false);
    // Delay so any remaining IPC output events (failure detail lines) flush first,
    // then flip chips: failed ones stay red, running ones become passed.
    setTimeout(() => finaliseProgress(false), 300);
    document.getElementById('terminal-footer').style.display = 'flex';
    document.getElementById('stop-btn').style.display = 'none';

    // Show loading state while report JSON is written
    const s = document.getElementById('run-summary');
    s.innerHTML = '<span class="chip chip-total">⏳ Reading results…</span>';

    // Wait briefly for custom reporter to finish writing JSON
    await new Promise(r => setTimeout(r, 1500));

    // Try report JSON first, fall back to log parsing
    let counts = await window.api.report.counts();
    if (!counts || counts.total === 0) {
      counts = parsePlaywrightCounts(fullLog);
    }

    renderSummaryBar(counts, exitCode);

    const notifyMsg = counts.total > 0
      ? `✓ ${counts.passed} passed · ✗ ${counts.failed} failed · ⊘ ${counts.skipped} skipped`
      : exitCode === 0 ? 'All tests passed' : 'Some tests failed';

    window.api.notify(exitCode === 0 ? 'Tests Passed' : 'Tests Finished', notifyMsg);
  });

  setRunning(true);
  await window.api.tests.run({ specPaths, env, headed: browser !== 'headless', debug: browser === 'debug', workers, retries });
});

document.getElementById('stop-btn').addEventListener('click', async () => {
  await window.api.tests.stop();
  setRunning(false);
  finaliseProgress(true);   // hide bar + chips on manual stop
  document.getElementById('stop-btn').style.display = 'none';
  document.getElementById('terminal-footer').style.display = 'flex';
  document.getElementById('run-summary').innerHTML = '<span class="summary-fail">■ Stopped by user</span>';
});
document.getElementById('back-to-config').addEventListener('click', () => { window.api.tests.stop(); showWizard(); });
document.getElementById('open-report-btn').addEventListener('click', async () => { const p = await window.api.report.find(); if (p) window.api.report.open(p); });

// ── Git view ──────────────────────────────────────────────
document.querySelectorAll('.branch-row').forEach(row => {
  row.addEventListener('click', async () => {
    let branch = row.dataset.branch;
    if (branch === '__current__') branch = await window.api.git.currentBranch();
    row.classList.add('loading');
    row.querySelector('.branch-arrow').textContent = '…';
    const log = document.getElementById('git-log');
    log.style.display = 'block';
    log.textContent = `Fetching upstream/${branch}…`;
    const result = await window.api.git.switchBranch(branch);
    row.classList.remove('loading');
    if (result.ok) {
      row.classList.add('done'); row.querySelector('.branch-arrow').textContent = '✓';
      log.textContent = result.output; refreshBranch();
      window.api.notify('Git', `Switched to ${branch}`);
    } else {
      row.classList.add('error'); row.querySelector('.branch-arrow').textContent = '✗';
      log.textContent = result.output;
    }
  });
});

// ── Report view ───────────────────────────────────────────
async function loadReport() {
  const label = document.getElementById('report-path-label');
  const btn   = document.getElementById('open-report-page');
  label.textContent = 'Searching…'; btn.style.display = 'none';
  const p = await window.api.report.find();
  if (p) {
    label.textContent = p.replace(/.*playwright-tests\//, '');
    label.style.color = 'var(--text)';
    btn.style.display = 'inline-block';
    btn.onclick = () => window.api.report.open(p);
  } else {
    label.textContent = 'No report found. Run some tests first.';
    label.style.color = 'var(--muted)';
  }
}

// ── Test result parser ────────────────────────────────────
function parsePlaywrightCounts(log) {
  // Strip ANSI codes for clean parsing
  const clean = log.replace(/\x1b\[[^m]*m/g, '');

  let passed = 0, failed = 0, skipped = 0, flaky = 0;

  // Playwright formats: "5 passed", "3 failed", "2 skipped", "1 flaky"
  const passMatch   = clean.match(/(\d+)\s+passed/);
  const failMatch   = clean.match(/(\d+)\s+failed/);
  const skipMatch   = clean.match(/(\d+)\s+skipped/);
  const flakyMatch  = clean.match(/(\d+)\s+flaky/);

  if (passMatch)  passed  = parseInt(passMatch[1]);
  if (failMatch)  failed  = parseInt(failMatch[1]);
  if (skipMatch)  skipped = parseInt(skipMatch[1]);
  if (flakyMatch) flaky   = parseInt(flakyMatch[1]);

  const total = passed + failed + skipped + flaky;
  return { passed, failed, skipped, flaky, total };
}

function renderSummaryBar({ passed, failed, skipped, flaky, total }, exitCode) {
  const s = document.getElementById('run-summary');

  const chips = [];

  if (total > 0) {
    chips.push(`<span class="chip chip-total">📋 ${total} total</span>`);
  }
  if (passed > 0) {
    chips.push(`<span class="chip chip-pass">✓ ${passed} passed</span>`);
  }
  if (failed > 0) {
    chips.push(`<span class="chip chip-fail">✗ ${failed} failed</span>`);
  }
  if (skipped > 0) {
    chips.push(`<span class="chip chip-skip">⊘ ${skipped} skipped</span>`);
  }
  if (flaky > 0) {
    chips.push(`<span class="chip chip-flaky">⚡ ${flaky} flaky</span>`);
  }

  if (chips.length === 0) {
    // Fallback if parsing failed
    s.innerHTML = exitCode === 0
      ? '<span class="summary-pass">✓ All tests passed</span>'
      : '<span class="summary-fail">✗ Some tests failed — check the report</span>';
    return;
  }

  s.innerHTML = chips.join('');
}

// ── Helpers ───────────────────────────────────────────────
function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx))
    + `<mark>${escapeHtml(text.slice(idx, idx + query.length))}</mark>`
    + escapeHtml(text.slice(idx + query.length));
}
function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
// ANSI conversion handled securely in main process via ansi-to-html (escapeXML: true)
