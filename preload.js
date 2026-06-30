const { contextBridge, ipcRenderer } = require('electron');

// ── FIX 5: Input validation at the bridge boundary ───────────
const VALID_BRANCH    = /^[a-zA-Z0-9._\-/]+$/;
const VALID_ENV       = ['prod', 'staging'];
const VALID_REPORTERS = ['default', 'line', 'dot', 'list'];
const VALID_PDF_FLAGS = ['STITCH_PDF', 'STITCH_PDF_ONLY', 'HIGHLIGHT_ONLY'];

function assertString(v, maxLen = 500) {
  if (typeof v !== 'string' || v.length > maxLen) throw new Error('Invalid string input');
  return v;
}
function assertBranch(b) {
  assertString(b, 100);
  if (!VALID_BRANCH.test(b)) throw new Error('Invalid branch name');
  return b;
}
function assertEnv(e) {
  if (!VALID_ENV.includes(e)) throw new Error('Invalid env');
  return e;
}
function assertInt(n, min = 0, max = 16) {
  const i = parseInt(n);
  if (isNaN(i) || i < min || i > max) throw new Error('Invalid integer');
  return i;
}
function assertPath(p) {
  assertString(p, 1000);
  if (p.includes('\0')) throw new Error('Invalid path');
  return p;
}

contextBridge.exposeInMainWorld('api', {
  repo: {
    get:     ()  => ipcRenderer.invoke('repo:get'),
    change:  ()  => ipcRenderer.invoke('repo:change'),
    onReady: cb  => ipcRenderer.on('repo:ready', (_, p) => cb(p))
  },
  git: {
    currentBranch: () => ipcRenderer.invoke('git:current-branch'),
    switchBranch:  (b) => ipcRenderer.invoke('git:switch', assertBranch(b))
  },
  specs: {
    all:     () => ipcRenderer.invoke('specs:all'),
    folders: () => ipcRenderer.invoke('specs:folders'),
    tests:   (paths) => {
      if (!Array.isArray(paths)) throw new Error('Invalid paths');
      paths.forEach(p => assertPath(p));
      return ipcRenderer.invoke('specs:tests', paths);
    }
  },
  tests: {
    run: (cfg) => {
      assertEnv(cfg.env);
      assertInt(cfg.workers, 1, 16);
      assertInt(cfg.retries, 0, 5);
      if (!Array.isArray(cfg.specPaths) || cfg.specPaths.length === 0) throw new Error('No spec paths');
      cfg.specPaths.forEach(p => assertPath(p));
      const reporter = VALID_REPORTERS.includes(cfg.reporter) ? cfg.reporter : 'default';
      const payload = {
        specPaths: cfg.specPaths,
        env:       cfg.env,
        headed:    !!cfg.headed,
        debug:     !!cfg.debug,
        workers:   assertInt(cfg.workers, 1, 16),
        retries:   assertInt(cfg.retries, 0, 5),
        reporter
      };
      if (cfg.grep != null) payload.grep = assertString(cfg.grep, 5000);
      if (cfg.pdfFlag != null) {
        if (!VALID_PDF_FLAGS.includes(cfg.pdfFlag)) throw new Error('Invalid PDF flag');
        payload.pdfFlag = cfg.pdfFlag;
      }
      return ipcRenderer.invoke('tests:run', payload);
    },
    stop:      ()   => ipcRenderer.invoke('tests:stop'),
    onOutput:  (cb) => ipcRenderer.on('tests:output', (_, d) => cb(d)),
    onDone:    (cb) => ipcRenderer.on('tests:done',   (_, d) => cb(d)),
    offOutput: ()   => ipcRenderer.removeAllListeners('tests:output'),
    offDone:   ()   => ipcRenderer.removeAllListeners('tests:done')
  },
  report: {
    find:   ()  => ipcRenderer.invoke('report:find'),
    open:   (p) => ipcRenderer.invoke('report:open', assertPath(p)),
    counts: ()  => ipcRenderer.invoke('report:counts')
  },
  ansi: { convert: (raw) => ipcRenderer.invoke('ansi:convert', assertString(raw, 100000)) },
  notify: (title, body) => ipcRenderer.invoke('notify', {
    title: assertString(title, 100),
    body:  assertString(body,  200)
  }),
  slack: {
    send: (type, data) => {
      const VALID_TYPES = ['start', 'finish'];
      if (!VALID_TYPES.includes(type)) throw new Error('Invalid notification type');
      return ipcRenderer.invoke('slack:send', { type, data: data || {} });
    }
  }
});
