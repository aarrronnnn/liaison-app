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
const { StructurePool, StructureCache } = require('./structure');
const { AnalysisService } = require('./analysis');
const clientlist = require('./clientlist');
const cratesmod = require('./crates');
const filtersmod = require('./filters');
const landing = require('./landing');
const acquire = require('./acquire');
const TRAY_ICON = require('./tray-icon');
const { License, TIERS, API } = require('./license');

const DIR = () => app.getPath('userData');
const CFG = () => path.join(DIR(), 'config.json');
const CACHE = () => path.join(DIR(), 'analysis-cache.json');
const SETS = () => path.join(DIR(), 'sets.json');
const LIC = () => path.join(DIR(), 'license.json');
const STRUCT = () => path.join(DIR(), 'structure-cache.json');

const DEFAULTS = {
  source: null, sourceOpts: {},
  autoLibrary: true, autoWidget: true, launchAtLogin: true, prolinkAnnounce: false,
  libraryMode: null, libraryPath: null,
  pack: 'fr-club', sessionName: 'Session', guestWeight: 0.5,
  arc: 'up', mode: 'crowd', banned: [], guestPort: 7373,
  revealOnLoad: false, opacity: 1,
  /* les listes du client : ce qu'il veut entendre, ce qu'il refuse */
  clientWanted: [], clientBanned: [], clientName: '',
  guestCooldown: 90, guestMax: 5,
  spotifyId: '', spotifySecret: '',
  /* les filtres de cabine — l'etat des quatre interrupteurs */
  fCrate: null, fSkipPlayed: false, fNoExplicit: false, fBpmMin: 0, fBpmMax: 0,
  /* nuit par defaut : une cabine est sombre */
  theme: 'nuit'
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
/* listes du client, une fois rapprochees de la bibliotheque */
let clientSet = { wanted: new Set(), banned: new Set(), dna: {}, stats: null };
let license = null;
/* les listes deja faites par le DJ, relues depuis ses sources */
let crateList = [];
/* l'analyse de fond : elle tourne pendant que le DJ mixe */
let analyse = null;
/* le plan d'atterrissage courant, et l'heure ou il a ete pose */
let landPlan = null, landAt = 0;

/* ---- structure des morceaux : points de mix ---- */
const structPool = new StructurePool(2);
let structCache = null;
const structures = new Map();      /* id du morceau -> structure */
const structBusy = new Set();
let structTimer = null;

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
  library = lib.finalize(tracks);
  rebuildClient();
  rebuildCrates([{ kind: mode === 'rekordbox' ? 'rekordbox' : 'folder', path: p }]);
  config.libraryMode = mode; config.libraryPath = p; saveConfig();
  send('library', { n: library.length, crates: crateList.length });
  /* la bibliotheque est jouable des maintenant ; l'analyse suit */
  startAnalysis();
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
    /* On ne fait plus attendre le DJ : la base du logiciel donne
       deja titre, artiste, BPM et tonalite, et c'est tout ce qu'il
       faut pour proposer un enchainement. L'energie et le timbre
       arrivent ensuite, morceau par morceau, sans bloquer. */
    library = libmod.finalize(merged);
    rebuildClient();
    rebuildCrates(ordered);
    send('library', { n: library.length, crates: crateList.length,
                      sources: ordered.map(s => ({ kind: s.kind, path: s.path })) });
    startAnalysis();

    if (libraryWatcher) libraryWatcher.stop();
    libraryWatcher = autolib.watch(ordered, () => autoImport(preferKind));
  } finally { importing = false; }
}

/* ============================================================
   L'analyse de fond.

   Elle demarre quand la bibliotheque est prete, et elle est
   completement facultative : le widget fonctionne pendant qu'elle
   tourne. Le morceau qui tourne et les suggestions passent devant
   tout le reste, ce qui fait qu'en pratique l'analyse est deja
   faite pour les morceaux que le DJ regarde.
   ============================================================ */
let dernierRapport = null;

function startAnalysis() {
  if (analyse) analyse.stop();
  analyse = new AnalysisService(CACHE(), {
    onProgress: p => {
      dernierRapport = p;
      send('analysis', p);
    },
    /* Un morceau qui vient d'etre analyse peut changer le
       classement. On ne recalcule pas a chaque resultat — trois
       par seconde feraient clignoter la liste — mais toutes les
       quatre secondes, et seulement si quelque chose tourne. */
    onTrack: () => scheduleResuggest()
  });
  const r = analyse.charger(library);
  send('analysis', { phase: 'analyse', done: 0, total: r.aFaire, restants: r.aFaire,
                     caches: r.caches, demarrage: true });
  analyse.demarrer();
  prioriserAnalyse();
}

let resugTimer = null;
function scheduleResuggest() {
  if (resugTimer || !current) return;
  resugTimer = setTimeout(() => {
    resugTimer = null;
    if (current) send('suggestions', computeSuggestions(config.suggestCount || 3));
  }, 4000);
}

/** Dit a l'analyse ce que le moteur est en train de regarder. */
function prioriserAnalyse() {
  if (!analyse) return;
  if (current) analyse.prioriser([current.id], 2);
  /* Les cent morceaux les plus proches en tempo : ce sont les
     seuls que le moteur peut proposer dans l'immediat, donc les
     seuls dont l'energie change quelque chose maintenant. */
  if (current && current.bpm > 0) {
    const proches = library
      .filter(t => t.id !== current.id && t.bpm > 0 && !t.analyzed)
      .map(t => ({ id: t.id, d: Math.abs(t.bpm - current.bpm) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 100)
      .map(x => x.id);
    analyse.prioriser(proches, 1);
  }
}

/* Les listes deja faites par le DJ. On les relit apres chaque import :
   une crate ajoutee dans Serato a midi doit etre la le soir meme.
   Si le filtre pointait une liste qui a disparu, on le relache plutot
   que de laisser un filtre fantome vider le widget. */
function rebuildCrates(sources) {
  try { crateList = cratesmod.readAll(sources || librarySources, library); }
  catch (e) { crateList = []; }
  if (config.fCrate && !crateList.some(c => c.id === config.fCrate)) {
    config.fCrate = null;
    saveConfig();
  }
}

/* ---------------- ADN de la session ---------------- */
/* ============================================================
   Structure a la demande.

   On n'analyse pas la bibliotheque entiere : seulement le morceau
   qui tourne et les titres proposes. C'est deux secondes de calcul
   par morceau, dans un fil separe, et le resultat est garde sur
   disque tant que le fichier ne change pas.
   ============================================================ */
function ensureStructure(track) {
  if (!track || !track.path || structures.has(track.id) || structBusy.has(track.id)) return;
  if (structCache) {
    const hit = structCache.get(track);
    if (hit) { structures.set(track.id, hit); return; }
  }
  structBusy.add(track.id);
  structPool.run(track.path, track.bpm)
    .then(r => {
      structures.set(track.id, r);
      if (structCache) { structCache.set(track, r); structCache.save(); }
      scheduleStructRefresh();
    })
    .catch(() => { structures.set(track.id, { ok: false }); })
    .then(() => { structBusy.delete(track.id); });
}

/* Une structure qui arrive change les reperes affiches : on renvoie
   la liste, mais groupee, pour ne pas la reconstruire six fois. */
function scheduleStructRefresh() {
  if (structTimer) return;
  structTimer = setTimeout(() => {
    structTimer = null;
    if (current) send('suggestions', computeSuggestions(config.suggestCount || 3));
  }, 350);
}

function planFor(nextTrack) {
  if (!current) return null;
  const a = structures.get(current.id), b = structures.get(nextTrack.id);
  if (!a || !b || !a.ok || !b.ok) return null;
  return engine.mixPlan(current, nextTrack, a, b);
}

/* ============================================================
   Les listes du client.

   Le client envoie ce qu'il veut entendre et ce qu'il ne veut pas.
   Les titres voulus sont joues ET tirent l'ADN de la soiree vers
   leurs genres : c'est ce qui fait qu'un mariage a Nantes ne
   ressemble pas au mariage d'a cote. Les titres refuses sortent du
   moteur, definitivement — un « surtout pas celle-la » ne se
   negocie pas.
   ============================================================ */
function rebuildClient() {
  const empty = { wanted: new Set(), banned: new Set(), dna: {}, stats: null };
  if (!library.length) { clientSet = empty; return; }

  const w = clientlist.resolve(config.clientWanted || [], library, engine.match);
  const b = clientlist.resolve(config.clientBanned || [], library, engine.match);

  clientSet = {
    wanted: new Set(w.matched.map(m => m.track.id)),
    banned: new Set(b.matched.map(m => engine.keyOf(m.track))),
    dna: clientlist.dnaOf(w.matched.map(m => m.track)),
    stats: {
      wanted: { total: (config.clientWanted || []).length, trouves: w.matched.length, manquants: w.missing.length },
      banned: { total: (config.clientBanned || []).length, trouves: b.matched.length, manquants: b.missing.length },
      /* Chaque titre absent repart avec de quoi le trouver : les
         boutiques ou il s'achete, et ce que le DJ possede peut-etre
         deja sous une autre orthographe. */
      manquants: w.missing.slice(0, 40).map(m => ({
        artist: m.artist, title: m.title,
        achats: acquire.buyLinks(m),
        deja: acquire.nearMisses(m, library, engine.match, 2)
      }))
    }
  };
}

/** Tout ce que le moteur doit exclure : la liste du DJ plus celle du client. */
function bannedSet() {
  const out = new Set((config.banned || []).map(x => String(x).toLowerCase()));
  for (const k of clientSet.banned) out.add(k);
  return out;
}

/* La file des invites, telle que le widget la montre : le compte de
   telephones distincts, et le morceau de la bibliotheque qui correspond
   — ou, s'il manque, de quoi l'acheter apres la soiree. */
function requestList() {
  return guests.top().slice(0, 12).map(r => {
    const m = engine.match((r.artist ? r.artist + ' ' : '') + r.title, library, 0.5);
    return {
      title: r.title, artist: r.artist, n: r.n, at: r.at,
      id: m ? m.track.id : null,
      have: !!m,
      match: m ? { title: m.track.title, artist: m.track.artist, bpm: m.track.bpm, key: m.track.key } : null
    };
  });
}

/* ------------------------------------------------------------
   Les filtres de cabine.

   Ils s'appliquent avant le moteur, jamais apres : un morceau
   ecarte ne doit pas avoir de score, sinon il reapparait des que
   le classement change. Le tamis est reconstruit a chaque appel
   parce que « deja joue ce soir » bouge a chaque morceau.
   ------------------------------------------------------------ */
function currentFilter() {
  const crate = config.fCrate ? crateList.find(c => c.id === config.fCrate) : null;
  const f = {
    crate: crate ? { name: crate.name, ids: crate.ids } : null,
    skipPlayed: !!config.fSkipPlayed,
    playedIds: setlog ? setlog.playedIds() : new Set(),
    noExplicit: !!config.fNoExplicit,
    bpmMin: config.fBpmMin || 0, bpmMax: config.fBpmMax || 0
  };
  /* la cloture reservee sort des suggestions jusqu'a son heure */
  const ph = landingNow();
  const reserve = landPlan && landPlan.closer && ph && !ph.liberer ? landPlan.closer.id : null;
  const base = filtersmod.build(f);
  return {
    tracks: filtersmod.apply(library, f),
    keep: reserve ? (t => base.keep(t) && t.id !== reserve) : base.keep,
    reserve: reserve
  };
}

/** Ou en est le set par rapport au plan d'atterrissage. */
function landingNow() {
  if (!landPlan || !landPlan.ok) return null;
  return landing.now(landPlan, (Date.now() - landAt) / 60000);
}

function currentDNA() {
  const pack = locales.byId(config.pack);
  const guestDNA = {};
  for (const r of guests.top()) {
    const m = engine.match(r.artist + ' ' + r.title, library, 0.5);
    if (m) for (const tag of m.track.tags || []) guestDNA[tag] = Math.min(100, (guestDNA[tag] || 40) + r.n * 8);
  }
  let dna = locales.blendDNA(pack, guestDNA, Object.keys(guestDNA).length ? config.guestWeight : 0);
  /* Le client passe avant le pack de pays : c'est sa soiree. */
  if (Object.keys(clientSet.dna).length) dna = locales.blendDNA({ dna: dna }, clientSet.dna, 0.45);
  return dna;
}

function computeSuggestions(limit) {
  if (!current) return [];
  const f = feat();
  const n = Math.min(limit || config.suggestCount || 3, f.suggestions);
  const mode = (config.mode === 'trend' && !f.trends) ? 'crowd' : config.mode;

  const tam = currentFilter();
  let vivier = tam.tracks.tracks;
  if (tam.reserve) vivier = vivier.filter(t => t.id !== tam.reserve);

  /* Pendant l'atterrissage, c'est le plan qui commande la courbe :
     le DJ a annonce une heure de fin, elle prime sur le pack. */
  const ph = landingNow();
  const arc = ph ? ph.arc : config.arc;

  return engine.suggest(current, vivier, {
    dna: currentDNA(), arc: arc, mode: mode,
    banned: bannedSet(), wanted: clientSet.wanted,
    trends: trends, limit: n
  }).map(r => {
    ensureStructure(r.track);
    const plan = planFor(r.track);
    const st = structures.get(r.track.id);
    return {
      title: r.track.title, artist: r.track.artist, key: r.track.key, bpm: r.track.bpm,
      energy: r.track.energy, id: r.track.id, path: r.track.path,
      total: r.total, transition: r.transition.n, why: r.transition.d,
      delta: Math.round((r.tempo.delta / current.bpm) * 1000) / 10,
      trend: r.trend, h: Math.round(r.h), tempoS: Math.round(r.tempo.s),
      crowd: r.crowd, timbre: Math.round(r.timbreScore),
      plan: plan, introBars: st && st.ok ? st.introBars : null, client: !!r.client,
      /* « tu l'as deja passe » : ce soir, ou une autre fois au meme endroit */
      deja: setlog ? setlog.lastPlay(r.track.id, { sameName: config.sessionName }) : null
    };
  });
}

function setCurrent(track, how) {
  current = track;
  ensureStructure(track);
  prioriserAnalyse();
  if (setlog) setlog.play(track, how || null);
  send('now', current ? {
    id: current.id, title: current.title, artist: current.artist, key: current.key,
    bpm: current.bpm, energy: current.energy, how: how || 'auto',
    structure: structures.get(current.id) || null
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
/* ---------------- listes du client ---------------- */
ipcMain.handle('client:get', () => ({
  name: config.clientName || '',
  wanted: config.clientWanted || [],
  banned: config.clientBanned || [],
  stats: clientSet.stats,
  dna: clientSet.dna,
  spotify: !!(config.spotifyId && config.spotifySecret)
}));

/** Ajoute des titres a une liste. `source` vaut 'texte' ou une adresse Spotify. */
ipcMain.handle('client:import', async (e, opt) => {
  opt = opt || {};
  const side = opt.side === 'banned' ? 'clientBanned' : 'clientWanted';
  let entries = [];
  try {
    if (opt.url) entries = await clientlist.fromSpotify(opt.url, config.spotifyId, config.spotifySecret);
    else entries = clientlist.parseList(opt.text);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (!entries.length) return { ok: false, error: 'Aucun titre lisible dans ce que tu as colle.' };

  /* on ajoute sans doublonner ce qui est deja dans la liste */
  const seen = new Set((config[side] || []).map(x => ((x.artist || '') + '|' + x.title).toLowerCase()));
  const added = entries.filter(x => !seen.has(((x.artist || '') + '|' + x.title).toLowerCase()));
  config[side] = (config[side] || []).concat(added);
  saveConfig();
  rebuildClient();
  if (current) send('suggestions', computeSuggestions(config.suggestCount || 3));
  send('client', { stats: clientSet.stats });
  return { ok: true, lus: entries.length, ajoutes: added.length, stats: clientSet.stats };
});

/** La liste de courses, prete a coller dans un panier ou un mail. */
ipcMain.handle('client:shopping', () => {
  const m = (clientSet.stats && clientSet.stats.manquants) || [];
  const txt = acquire.shoppingList(m);
  if (txt) clipboard.writeText(txt);
  return { ok: !!txt, n: m.length, texte: txt, pools: acquire.POOLS };
});

ipcMain.handle('client:clear', (e, side) => {
  config[side === 'banned' ? 'clientBanned' : 'clientWanted'] = [];
  saveConfig();
  rebuildClient();
  if (current) send('suggestions', computeSuggestions(config.suggestCount || 3));
  send('client', { stats: clientSet.stats });
  return { ok: true, stats: clientSet.stats };
});

ipcMain.handle('client:remove', (e, opt) => {
  const side = opt.side === 'banned' ? 'clientBanned' : 'clientWanted';
  config[side] = (config[side] || []).filter(x =>
    ((x.artist || '') + '|' + x.title).toLowerCase() !== String(opt.key).toLowerCase());
  saveConfig();
  rebuildClient();
  if (current) send('suggestions', computeSuggestions(config.suggestCount || 3));
  return { ok: true, stats: clientSet.stats };
});

ipcMain.handle('structure:get', (e, id) => structures.get(id) || null);

/* Ou en est l'analyse de fond, et pourquoi le widget dit ce qu'il dit. */
ipcMain.handle('analysis:state', () => {
  const n = library.length;
  const pret = library.filter(t => t.analyzed).length;
  return {
    library: n,
    analyses: pret,
    offline: analyse ? analyse.compterAbsents() : 0,
    restants: dernierRapport ? dernierRapport.restants : (analyse ? analyse.file.size : 0),
    fils: analyse ? analyse.workers.length : 0,
    sansFils: analyse ? !!analyse.sansFils : false,
    importing: importing
  };
});

/* Le bouton de sauvetage : on ignore la courbe de soiree.
   On respecte en revanche le crate, les BPM et les paroles — ce sont
   des interdits de la salle, pas des preferences. Mais pas « deja
   joue » : quand la piste se vide, le titre qui a marche il y a une
   heure est justement le bon. */
ipcMain.handle('rescue', () => {
  if (!current) return [];
  const secours = filtersmod.apply(library, {
    crate: config.fCrate ? (function () {
      const c = crateList.find(x => x.id === config.fCrate);
      return c ? { name: c.name, ids: c.ids } : null;
    })() : null,
    noExplicit: !!config.fNoExplicit,
    bpmMin: config.fBpmMin || 0, bpmMax: config.fBpmMax || 0
  }).tracks;
  return engine.rescue(current, secours, {
    dna: currentDNA(),
    banned: bannedSet(), wanted: clientSet.wanted,
    structures: structures,
    limit: 3
  }).map(r => {
    ensureStructure(r.track);
    return {
      id: r.track.id, title: r.track.title, artist: r.track.artist,
      key: r.track.key, bpm: r.track.bpm, energy: r.track.energy, path: r.track.path,
      total: r.total, why: r.why, introBars: r.introBars, client: !!r.client,
      transition: r.transition.n,
      delta: Math.round((r.tempo.delta / current.bpm) * 1000) / 10,
      plan: planFor(r.track),
      deja: setlog ? setlog.lastPlay(r.track.id, { sameName: config.sessionName }) : null
    };
  });
});

ipcMain.handle('now:get', () => current && {
  id: current.id, title: current.title, artist: current.artist, key: current.key,
  bpm: current.bpm, energy: current.energy,
  structure: structures.get(current.id) || null
});

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
    cooldown: config.guestCooldown, maxPerDevice: config.guestMax,
    getLibrary: () => library,
    onRequest: () => {
      send('requests', requestList());
      if (current) send('suggestions', computeSuggestions(config.suggestCount || 3));
    }
  });
  if (!setlog) setlog = new SetLog(SETS());
  setlog.open(config.sessionName, config.pack);
  return { url: url, qr: await qrPNG(url), share: shareLinks(url, config.sessionName) };
});
ipcMain.handle('session:requests', () => requestList());
ipcMain.handle('share:open', (e, url) => { shell.openExternal(url); return true; });
ipcMain.handle('share:copy', (e, text) => { clipboard.writeText(text); return true; });
ipcMain.handle('qr:save', async (e, dataUrl) => {
  const r = await dialog.showSaveDialog({ defaultPath: 'liaison-qr.png' });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
  return r.filePath;
});

/* ============================================================
   Les filtres de cabine
   ============================================================ */
ipcMain.handle('filters:get', () => {
  const tam = currentFilter();
  return {
    crates: crateList.map(c => ({ id: c.id, name: c.name, source: c.source, n: c.n })),
    etat: {
      crate: config.fCrate, skipPlayed: !!config.fSkipPlayed,
      noExplicit: !!config.fNoExplicit,
      bpmMin: config.fBpmMin || 0, bpmMax: config.fBpmMax || 0
    },
    /* combien de morceaux le tamis laisse passer, et s'il etouffe */
    restants: tam.tracks.tracks.length,
    total: library.length,
    vide: tam.tracks.vide,
    active: tam.tracks.active,
    /* le tempo joue, pour proposer une plage sensee en un clic */
    bpm: current ? current.bpm : null
  };
});

ipcMain.handle('filters:set', (e, patch) => {
  for (const k of ['fCrate', 'fSkipPlayed', 'fNoExplicit', 'fBpmMin', 'fBpmMax'])
    if (Object.prototype.hasOwnProperty.call(patch || {}, k)) config[k] = patch[k];
  saveConfig();
  if (current) send('suggestions', computeSuggestions(config.suggestCount || 3));
  const tam = currentFilter();
  send('filters', { restants: tam.tracks.tracks.length, vide: tam.tracks.vide, active: tam.tracks.active });
  return { ok: true, restants: tam.tracks.tracks.length, vide: tam.tracks.vide, active: tam.tracks.active };
});

ipcMain.handle('filters:crates', () => {
  crateList = cratesmod.readAll(librarySources, library);
  return crateList.map(c => ({ id: c.id, name: c.name, source: c.source, n: c.n }));
});

/* ============================================================
   L'atterrissage de fin de set
   ============================================================ */
ipcMain.handle('landing:plan', (e, minutes) => {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (!m) { landPlan = null; landAt = 0; if (current) send('suggestions', computeSuggestions(config.suggestCount || 3));
            return { ok: false, note: 'Plan efface — Liaison revient a la courbe de la soiree.' }; }
  const tam = currentFilter();
  landPlan = landing.plan({
    restantMin: m,
    library: tam.tracks.tracks,
    playedIds: setlog ? setlog.playedIds() : new Set(),
    playedDurs: setlog ? setlog.playedDurations() : [],
    banned: bannedSet(), wanted: clientSet.wanted
  });
  landAt = Date.now();
  if (current) send('suggestions', computeSuggestions(config.suggestCount || 3));
  return Object.assign({}, landPlan, { phase: landingNow() });
});

ipcMain.handle('landing:get', () =>
  landPlan && landPlan.ok ? Object.assign({}, landPlan, { phase: landingNow() }) : null);

ipcMain.handle('landing:clear', () => {
  landPlan = null; landAt = 0;
  if (current) send('suggestions', computeSuggestions(config.suggestCount || 3));
  return { ok: true };
});

/* ============================================================
   La tracklist
   ============================================================ */
ipcMain.handle('sets:list', () => (setlog ? setlog.list() : []));
ipcMain.handle('sets:tracklist', (e, id) => (setlog ? setlog.tracklist(id) : null));
ipcMain.handle('sets:copy', (e, id) => {
  if (!setlog) return { ok: false };
  const t = setlog.texte(id);
  if (!t) return { ok: false };
  clipboard.writeText(t);
  return { ok: true, n: t.split('\n').length };
});

/* Le fichier des declarations. On propose un nom parlant : c'est ce
   qu'on retrouvera dans le dossier six mois plus tard, au moment de
   declarer. */
ipcMain.handle('sets:export', async (e, opt) => {
  if (!setlog) return { ok: false };
  const id = opt && opt.id;
  const format = (opt && opt.format) === 'txt' ? 'txt' : 'csv';
  const t = setlog.tracklist(id);
  if (!t) return { ok: false, error: 'Cette session ne contient aucun morceau.' };
  const d = new Date(t.at);
  const jour = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const propre = String(t.name || 'session').replace(/[\/\\:*?"<>|]/g, '-').slice(0, 60);
  const r = await dialog.showSaveDialog({
    title: 'Enregistrer la tracklist',
    defaultPath: 'Tracklist ' + jour + ' - ' + propre + '.' + format,
    filters: [format === 'csv'
      ? { name: 'Tableur / declaration', extensions: ['csv'] }
      : { name: 'Texte', extensions: ['txt'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(r.filePath, format === 'csv' ? setlog.csv(id) : setlog.texte(id), 'utf8');
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
  return { ok: true, path: r.filePath, n: t.lignes.length };
});
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
/* ============================================================
   Le menu de l'application.

   Sans menu explicite, Electron en fabrique un en anglais :
   File / Edit / View / Window. Sur une app francaise vendue a des
   DJs francais, c'est la premiere chose qu'on lit et la premiere
   qui trahit. On le reecrit donc entierement — en gardant les
   roles natifs, qui portent les raccourcis clavier et le
   comportement systeme corrects dans chaque langue.
   ============================================================ */
function buildMenu() {
  const mac = process.platform === 'darwin';
  const modele = [];

  if (mac) modele.push({
    label: 'Liaison',
    submenu: [
      { label: 'À propos de Liaison', role: 'about' },
      { type: 'separator' },
      { label: 'Réglages…', accelerator: 'Cmd+,', click: () => openSettings() },
      { label: 'Licence…', click: () => openLicence('plans') },
      { type: 'separator' },
      { label: 'Masquer Liaison', role: 'hide' },
      { label: 'Masquer les autres', role: 'hideOthers' },
      { label: 'Tout afficher', role: 'unhide' },
      { type: 'separator' },
      { label: 'Quitter Liaison', role: 'quit' }
    ]
  });

  modele.push({
    label: 'Fichier',
    submenu: [
      { label: 'Relire ma bibliothèque', click: () => autoImport(activeApp && activeApp.librarySource) },
      { label: 'Choisir un dossier de musique…', click: () => openSettings() },
      { type: 'separator' },
      ...(mac ? [{ label: 'Fermer la fenêtre', role: 'close' }]
              : [{ label: 'Réglages…', accelerator: 'Ctrl+,', click: () => openSettings() },
                 { label: 'Licence…', click: () => openLicence('plans') },
                 { type: 'separator' },
                 { label: 'Quitter', role: 'quit' }])
    ]
  });

  modele.push({
    label: 'Édition',
    submenu: [
      { label: 'Annuler', role: 'undo' },
      { label: 'Rétablir', role: 'redo' },
      { type: 'separator' },
      { label: 'Couper', role: 'cut' },
      { label: 'Copier', role: 'copy' },
      { label: 'Coller', role: 'paste' },
      ...(mac ? [{ label: 'Coller en adaptant le style', role: 'pasteAndMatchStyle' }] : []),
      { label: 'Tout sélectionner', role: 'selectAll' }
    ]
  });

  modele.push({
    label: 'Affichage',
    submenu: [
      { label: 'Afficher le widget', click: () => { if (widget) { widget.show(); widget.focus(); } } },
      { label: 'Masquer le widget', click: () => { if (widget) widget.hide(); } },
      { type: 'separator' },
      { label: 'Taille réelle', role: 'resetZoom' },
      { label: 'Agrandir', role: 'zoomIn' },
      { label: 'Réduire', role: 'zoomOut' },
      { type: 'separator' },
      { label: 'Plein écran', role: 'togglefullscreen' },
      { label: 'Outils de développement', role: 'toggleDevTools' }
    ]
  });

  modele.push({
    label: 'Fenêtre',
    submenu: [
      { label: 'Réduire', role: 'minimize' },
      ...(mac ? [{ label: 'Placer en zoom', role: 'zoom' },
                 { type: 'separator' },
                 { label: 'Tout ramener au premier plan', role: 'front' }]
              : [{ label: 'Fermer', role: 'close' }])
    ]
  });

  modele.push({
    label: 'Aide',
    submenu: [
      { label: 'Première ouverture', click: () => shell.openExternal(API + '/premiere-ouverture.html') },
      { label: 'Site de Liaison', click: () => shell.openExternal(API) },
      { type: 'separator' },
      { label: 'Nous écrire', click: () => shell.openExternal('mailto:contact@liaison.dj?subject=Liaison%20' + app.getVersion()) }
    ]
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(modele));
}

app.whenReady().then(async () => {
  loadConfig();
  buildMenu();
  license = new License(LIC());
  license.ensureTrial();
  setlog = new SetLog(SETS());
  structCache = new StructureCache(STRUCT());
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
app.on('before-quit', () => {
  app.isQuitting = true;
  watcher.stop(); now.stop(); guests.stop();
  if (libraryWatcher) libraryWatcher.stop();
  if (structCache) structCache.save();
  structPool.close();
});
