'use strict';
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const engine = require('./engine');
const libmod = require('./library');
const lib = libmod;
const locales = require('./locales');
const { NowPlaying } = require('./sources');
const { GuestServer, SetLog, qrPNG, shareLinks } = require('./session');
const { reshuffle } = require('./setbuilder');
const autolib = require('./autolibrary');
const { AppWatcher } = require('./watcher');
const TRAY_ICON = require('./tray-icon');
const { License, TIERS, API } = require('./license');

const DIR = () => app.getPath('userData');
const CFG = () => path.join(DIR(), 'config.json');
const CACHE = () => path.join(DIR(), 'analysis-cache.json');
const SETS = () => path.join(DIR(), 'sets.json');
const LIC = () => path.join(DIR(), 'license.json');

const DEFAULTS = {
  source: null, sourceOpts: {},
  autoLibrary: true, autoWidget: true, launchAtLogin: true, prolinkAnnounce: false,
  libraryMode: null, libraryPath: null,
  pack: 'fr-club', sessionName: 'Session', guestWeight: 0.5,
  arc: 'up', mode: 'crowd', banned: [], guestPort: 7373,
  revealOnLoad: false, opacity: 1
};

let config = Object.assign({}, DEFAULTS);
let library = [];
let current = null;
let widget = null, settings = null, tray = null, licence = null;
let librarySources = [], libraryWatcher = null, importing = false;
const watcher = new AppWatcher(4000);
let activeApp = null;
const now = new NowPlaying();
const guests = new GuestServer();
let setlog = null;
let trends = new Map();
let license = null;
const feat = () => (license ? license.features() : TIERS.trial);

function loadConfig() {
  try { config = Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(CFG(), 'utf8'))); } catch (e) {}
}
function saveConfig() {
  try { fs.mkdirSync(DIR(), { recursive: true }); fs.writeFileSync(CFG(), JSON.stringify(config, null, 1)); } catch (e) {}
}
const send = (ch, payload) => {
  for (const w of [widget, settings]) if (w && !w.isDestroyed()) w.webContents.send(ch, payload);
};

/* ---------------- fenetres ---------------- */
function createWidget() {
  const d = screen.getPrimaryDisplay().workArea;
  widget = new BrowserWindow({
    width: 344, height: 548,
    x: d.x + d.width - 372, y: d.y + 40,
    frame: false, resizable: false, maximizable: false, fullscreenable: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#13161B',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  widget.setAlwaysOnTop(true, 'screen-saver');
  if (widget.setVisibleOnAllWorkspaces) widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widget.loadFile(path.join(__dirname, 'ui', 'widget.html'));
  widget.on('closed', () => { widget = null; });
  widget.on('close', e => { if (!app.isQuitting) { e.preventDefault(); widget.hide(); } });
}
function openLicence(view) {
  if (licence && !licence.isDestroyed()) {
    licence.focus();
    if (view) licence.loadFile(path.join(__dirname, 'ui', 'licence.html'), { search: 'v=' + view });
    return;
  }
  licence = new BrowserWindow({
    width: 560, height: 600, resizable: false, maximizable: false, fullscreenable: false,
    title: 'Liaison', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#EDEDEF', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  licence.loadFile(path.join(__dirname, 'ui', 'licence.html'), view ? { search: 'v=' + view } : undefined);
  licence.once('ready-to-show', () => licence.show());
  licence.on('closed', () => { licence = null; });
}

function openSettings() {
  if (settings && !settings.isDestroyed()) { settings.focus(); return; }
  settings = new BrowserWindow({
    width: 940, height: 720, title: 'Liaison — reglages', backgroundColor: '#EDEDEF',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  settings.loadFile(path.join(__dirname, 'ui', 'settings.html'));
  settings.on('closed', () => { settings = null; });
}

/* ---------------- bibliotheque ---------------- */
async function importLibrary(mode, p) {
  const onProgress = x => send('progress', x);
  let tracks = [];
  if (mode === 'rekordbox') tracks = lib.parseRekordboxXML(p);
  else tracks = await lib.scanFolder(p, onProgress);
  send('progress', { phase: 'analyse', done: 0, total: tracks.length });
  await lib.analyzeAll(tracks, CACHE(), onProgress);
  library = lib.finalize(tracks);
  config.libraryMode = mode; config.libraryPath = p; saveConfig();
  send('library', { n: library.length });
  return library.length;
}

/* ---------------- decouverte automatique ---------------- */
async function autoImport(preferKind) {
  if (importing) return;
  importing = true;
  try {
    librarySources = autolib.detect();
    if (!librarySources.length) {
      send('status', { ok: false, msg: 'Aucune bibliotheque trouvee — ouvre les reglages' });
      return;
    }
    /* on privilegie la base du logiciel qui vient de s'ouvrir */
    const ordered = librarySources.slice().sort((a, b) =>
      (b.kind === preferKind ? 1 : 0) - (a.kind === preferKind ? 1 : 0));
    send('status', { ok: true, msg: 'Lecture : ' + ordered.map(s => s.kind).join(', ') });

    const lists = [];
    for (const src of ordered) {
      try { lists.push(await autolib.readSource(src, x => send('progress', x))); }
      catch (e) { send('status', { ok: false, msg: src.kind + ' : ' + e.message }); }
    }
    const merged = autolib.merge(lists);
    send('progress', { phase: 'analyse', done: 0, total: merged.length });
    await libmod.analyzeAll(merged, CACHE(), x => send('progress', x));
    library = libmod.finalize(merged);
    send('library', { n: library.length, sources: ordered.map(s => ({ kind: s.kind, path: s.path })) });

    if (libraryWatcher) libraryWatcher.stop();
    libraryWatcher = autolib.watch(ordered, () => autoImport(preferKind));
  } finally { importing = false; }
}

/* ---------------- ADN de la session ---------------- */
function currentDNA() {
  const pack = locales.byId(config.pack);
  const guestDNA = {};
  for (const r of guests.top()) {
    const m = engine.match(r.artist + ' ' + r.title, library, 0.5);
    if (m) for (const tag of m.track.tags || []) guestDNA[tag] = Math.min(100, (guestDNA[tag] || 40) + r.n * 8);
  }
  return locales.blendDNA(pack, guestDNA, Object.keys(guestDNA).length ? config.guestWeight : 0);
}

function computeSuggestions(limit) {
  if (!current) return [];
  const f = feat();
  const n = Math.min(limit || config.suggestCount || 3, f.suggestions);
  const mode = (config.mode === 'trend' && !f.trends) ? 'crowd' : config.mode;
  return engine.suggest(current, library, {
    dna: currentDNA(), arc: config.arc, mode: mode,
    banned: new Set((config.banned || []).map(s => s.toLowerCase())),
    trends: trends, limit: n
  }).map(r => ({
    title: r.track.title, artist: r.track.artist, key: r.track.key, bpm: r.track.bpm,
    energy: r.track.energy, id: r.track.id, path: r.track.path,
    total: r.total, transition: r.transition.n, why: r.transition.d,
    delta: Math.round((r.tempo.delta / current.bpm) * 1000) / 10,
    trend: r.trend, h: Math.round(r.h), tempoS: Math.round(r.tempo.s),
    crowd: r.crowd, timbre: Math.round(r.timbreScore)
  }));
}

function setCurrent(track, how) {
  current = track;
  if (setlog) setlog.play(track, how || null);
  send('now', current ? {
    title: current.title, artist: current.artist, key: current.key,
    bpm: current.bpm, energy: current.energy, how: how || 'auto'
  } : null);
  send('suggestions', computeSuggestions(config.suggestCount || 3));
}

/* ---------------- source now-playing ---------------- */
now.on('text', text => {
  const m = engine.match(text, library);
  if (m && (!current || m.track.id !== current.id)) setCurrent(m.track, 'detect');
  send('raw', { text: text, matched: m ? m.track.title : null });
});
now.on('status', s => send('status', s));

/* Pro DJ Link : un morceau vient d'etre charge sur un deck */
now.on('deck', st => {
  const t = library.find(x => x.rbId && x.rbId === st.trackId);
  if (t) { if (!current || t.id !== current.id) setCurrent(t, 'deck ' + st.device); }
  else send('raw', { text: 'Deck ' + st.device + ' — identifiant rekordbox ' + st.trackId, matched: null });
});

/* ---------------- IPC ---------------- */
ipcMain.handle('locales:pack', (e, country, event) => locales.compose(country, event));
ipcMain.handle('config:get', () => ({ config: config, countries: locales.COUNTRIES, events: locales.EVENTS, libraryCount: library.length,
  detected: autolib.detect(), running: watcher.current().map(a => ({ id: a.id, label: a.label })),
  license: license.status(),
  sets: setlog ? setlog.list() : [], guestUrl: guests.port ? guests.url() : null }));

ipcMain.handle('config:set', (e, patch) => {
  Object.assign(config, patch); saveConfig();
  if (patch.source) now.start(config.source, config.sourceOpts);
  send('suggestions', computeSuggestions(config.suggestCount || 3));
  return config;
});

ipcMain.handle('library:pick', async (e, mode) => {
  const r = mode === 'rekordbox'
    ? await dialog.showOpenDialog({ title: 'Choisis ton export rekordbox.xml', filters: [{ name: 'XML', extensions: ['xml'] }], properties: ['openFile'] })
    : await dialog.showOpenDialog({ title: 'Choisis ton dossier de musique', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const n = await importLibrary(mode, r.filePaths[0]);
  return { path: r.filePaths[0], n: n };
});

ipcMain.handle('source:pickFile', async () => {
  const r = await dialog.showOpenDialog({ title: 'Fichier now-playing', properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('suggest', () => computeSuggestions(config.suggestCount || 3));
ipcMain.handle('now:get', () => current && { title: current.title, artist: current.artist, key: current.key, bpm: current.bpm, energy: current.energy });

/* Chargement : on met le titre dans le presse-papier, on ecrit une
   playlist M3U que le logiciel peut ouvrir, et on peut reveler le fichier. */
ipcMain.handle('track:load', (e, id) => {
  const t = library.find(x => x.id === id);
  if (!t) return { ok: false };
  clipboard.writeText(t.title);
  const m3u = path.join(DIR(), 'Liaison - Suivant.m3u8');
  try { fs.writeFileSync(m3u, '#EXTM3U\n#EXTINF:-1,' + t.artist + ' - ' + t.title + '\n' + t.path + '\n'); } catch (err) {}
  if (config.revealOnLoad && t.path) { try { shell.showItemInFolder(t.path); } catch (err) {} }
  setCurrent(t, 'manuel');
  return { ok: true, copied: t.title, m3u: m3u };
});

ipcMain.handle('track:search', (e, q) => {
  const s = String(q || '').toLowerCase();
  if (s.length < 2) return [];
  return library.filter(t => (t.title + ' ' + t.artist).toLowerCase().includes(s)).slice(0, 8)
    .map(t => ({ id: t.id, title: t.title, artist: t.artist, key: t.key, bpm: t.bpm }));
});

ipcMain.handle('session:start', async (e, opts) => {
  if (!feat().sessions) return { error: 'Les sessions invites demandent une licence active.', locked: true };
  guests.stop();
  const url = await guests.start({
    port: config.guestPort, sessionName: config.sessionName,
    getLibrary: () => library,
    onRequest: top => { send('requests', top.slice(0, 8)); send('suggestions', computeSuggestions(config.suggestCount || 3)); }
  });
  if (!setlog) setlog = new SetLog(SETS());
  setlog.open(config.sessionName, config.pack);
  return { url: url, qr: await qrPNG(url), share: shareLinks(url, config.sessionName) };
});
ipcMain.handle('session:requests', () => guests.top().slice(0, 12));
ipcMain.handle('share:open', (e, url) => { shell.openExternal(url); return true; });
ipcMain.handle('share:copy', (e, text) => { clipboard.writeText(text); return true; });
ipcMain.handle('qr:save', async (e, dataUrl) => {
  const r = await dialog.showSaveDialog({ defaultPath: 'liaison-qr.png' });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
  return r.filePath;
});

ipcMain.handle('sets:list', () => (setlog ? setlog.list() : []));
ipcMain.handle('sets:replay', (e, opts) => {
  if (!feat().replay) return { error: 'Le rejeu de set demande une licence Resident ou Collectif.', locked: true };
  if (!setlog) return null;
  const prev = setlog.hydrate(opts.id, library);
  if (!prev.length) return { error: 'Set introuvable dans la bibliotheque actuelle.' };
  const additions = (opts.addIds || []).map(id => library.find(t => t.id === id)).filter(Boolean);
  const r = reshuffle(prev, additions, {
    dna: currentDNA(), arc: config.arc, drop: opts.drop || 0,
    trends: trends, banned: new Set((config.banned || []).map(s => s.toLowerCase()))
  });
  return {
    novelty: r.novelty, movedAvg: r.movedAvg, kept: r.kept, added: r.added,
    order: r.order.map((t, i) => ({ n: i + 1, id: t.id, title: t.title, artist: t.artist, key: t.key, bpm: t.bpm, energy: t.energy }))
  };
});

ipcMain.handle('licence:open', (e, view) => { openLicence(view); return true; });
ipcMain.handle('licence:close', () => { if (licence && !licence.isDestroyed()) licence.close(); return true; });
ipcMain.handle('icon:data', () => {
  try { return nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 128 }).toDataURL(); }
  catch (e) { return ''; }
});
ipcMain.handle('license:status', () => license.status());
ipcMain.handle('license:activate', async (e, key) => {
  const r = await license.activate(key);
  send('license', license.status());
  send('suggestions', computeSuggestions());
  refreshTray();
  return r;
});
ipcMain.handle('license:refresh', async () => {
  const r = await license.refresh(true);
  send('license', license.status());
  return Object.assign({ status: license.status() }, r);
});
ipcMain.handle('license:release', async () => {
  const r = await license.release();
  send('license', license.status());
  refreshTray();
  return r;
});
ipcMain.handle('license:buy', (e, plan) => {
  shell.openExternal(API + '/acheter/' + (plan || 'resident'));
  return true;
});

ipcMain.handle('library:auto', () => autoImport(activeApp && activeApp.librarySource));
ipcMain.handle('library:sources', () => autolib.detect());
ipcMain.handle('apps:running', () => watcher.current().map(a => ({ id: a.id, label: a.label, nowSource: a.nowSource })));
ipcMain.handle('widget:settings', () => openSettings());
ipcMain.handle('widget:close', () => { if (widget) widget.hide(); });
ipcMain.handle('widget:height', (e, h) => {
  const from = BrowserWindow.fromWebContents(e.sender);
  const win = from || widget;
  if (win && !win.isDestroyed()) win.setBounds(Object.assign(win.getBounds(), { height: Math.max(220, Math.min(900, Math.round(h))) }));
});

/* ---------------- barre de menus ---------------- */
function buildTray() {
  const img = nativeImage.createFromDataURL(TRAY_ICON).resize({ width: 18, height: 18 });
  if (img.setTemplateImage) img.setTemplateImage(true);
  tray = new Tray(img);
  refreshTray();
  tray.on('click', () => { if (widget) widget.isVisible() ? widget.hide() : widget.show(); });
}
function refreshTray() {
  if (!tray) return;
  const running = watcher.current();
  const label = running.length ? running.map(a => a.label).join(', ') : 'Aucun logiciel de mix';
  tray.setToolTip('Liaison — ' + label);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: label, enabled: false },
    { label: library.length ? library.length + ' titres prets' : 'Bibliotheque en cours…', enabled: false },
    { label: 'Licence : ' + license.status().label + (license.tier() === 'trial' ? ' (' + license.trialLeft() + ' j)' : ''), enabled: false },
    { type: 'separator' },
    { label: 'Afficher le widget', click: () => widget && widget.show() },
    { label: 'Masquer le widget', click: () => widget && widget.hide() },
    { label: 'Licence…', click: () => openLicence() },
    { label: 'Reglages…', click: openSettings },
    { type: 'separator' },
    { label: 'Relire la bibliotheque', click: () => autoImport(activeApp && activeApp.librarySource) },
    { type: 'separator' },
    { label: 'Quitter Liaison', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}

/* ---------------- surveillance des logiciels de mix ---------------- */
function wireWatcher() {
  watcher.on('open', async app_ => {
    activeApp = app_;
    send('app', { id: app_.id, label: app_.label, open: true });
    if (config.autoWidget && widget) { widget.show(); widget.setAlwaysOnTop(true, 'screen-saver'); }
    const kind = app_.nowSource;
    config.source = kind; saveConfig();
    const opts = kind === 'prolink' ? { announce: config.prolinkAnnounce } : config.sourceOpts;
    now.start(kind, opts);
    if (config.autoLibrary && !library.length) await autoImport(app_.librarySource);
    refreshTray();
  });
  watcher.on('close', app_ => {
    if (activeApp && activeApp.id === app_.id) {
      activeApp = null;
      now.stop();
      current = null;
      send('app', { id: app_.id, label: app_.label, open: false });
      if (config.autoWidget && widget) widget.hide();
    }
    refreshTray();
  });
  watcher.start();
}

/* ---------------- demarrage ---------------- */
app.whenReady().then(async () => {
  loadConfig();
  license = new License(LIC());
  license.ensureTrial();
  setlog = new SetLog(SETS());
  createWidget();
  if (config.autoWidget) widget.hide();          // le widget attend son logiciel
  buildTray();
  wireWatcher();

  if (config.launchAtLogin && app.setLoginItemSettings) {
    try { app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true }); } catch (e) {}
  }

  license.refresh(false).then(() => {
    send('license', license.status());
    refreshTray();
    if (license.tier() === 'none') openLicence('plans');
  });
  if (!license.state.seenWelcome) {
    license.state.seenWelcome = Date.now();
    license._save();
    openLicence('welcome');
  }
  if (config.autoLibrary) autoImport().then(refreshTray);
  else if (config.libraryPath) importLibrary(config.libraryMode, config.libraryPath).then(refreshTray);
});
app.on('window-all-closed', () => { /* Liaison vit dans la barre de menus */ });
app.on('activate', () => {
  if (!widget) createWidget();
  if (license && license.tier() === 'none') openLicence('plans');
  else if (settings && !settings.isDestroyed()) settings.focus();
  else openSettings();
});
app.on('before-quit', () => { app.isQuitting = true; watcher.stop(); now.stop(); guests.stop(); if (libraryWatcher) libraryWatcher.stop(); });
