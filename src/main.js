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
const health = require('./health');
const prepare = require('./prepare');
const clientlist = require('./clientlist');
const cratesmod = require('./crates');
const filtersmod = require('./filters');
const landing = require('./landing');
const acquire = require('./acquire');
const TRAY_ICON = require('./tray-icon');
const { License, TIERS, API } = require('./license');
const rbFichiers = require('./sources/rekordbox');
const { Gout } = require('./gout');

const DIR = () => app.getPath('userData');
const CFG = () => path.join(DIR(), 'config.json');
const CACHE = () => path.join(DIR(), 'analysis-cache.json');
const SETS = () => path.join(DIR(), 'sets.json');
const LIC = () => path.join(DIR(), 'license.json');
const STRUCT = () => path.join(DIR(), 'structure-cache.json');
/* Ce que Liaison a appris de CE DJ. Un fichier a part : on peut
   l'effacer sans rien perdre d'autre. */
const GOUT = () => path.join(DIR(), 'gout.json');
/* Les tags lus par ffprobe, gardes d'une soiree a l'autre : sans ce
   fichier, un dossier de 22 000 morceaux est relu en entier a chaque
   lancement. */
const SCAN = () => path.join(DIR(), 'scan-cache.json');

const DEFAULTS = {
  source: null, sourceOpts: {},
  autoLibrary: true, autoWidget: true, launchAtLogin: true, prolinkAnnounce: false,
  libraryMode: null, libraryPath: null,
  pack: 'fr-club', sessionName: 'Session', guestWeight: 0.5,
  /* « auto » par defaut : Liaison lit la pente dans ce qui est
     joue plutot que d'attendre qu'on la lui declare. */
  arc: 'auto', mode: 'crowd', banned: [], guestPort: 7373,
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
let gout = null;
const leGout = () => (gout || (gout = new Gout(GOUT())));
/* Ce qu'on proposait juste avant le changement de morceau : c'est
   l'etiquette de l'exemple qu'on est en train d'observer. */
let dernieresPropositions = [];
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
  else tracks = await lib.scanFolder(p, onProgress, { cache: SCAN() });
  library = lib.finalize(tracks);
  indexChemins = null;
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
    /* Ce qui manque pour aller vite — typiquement rekordbox
       installe sans export XML. On le dit avant le scan, pas
       apres deux heures. */
    const avis = autolib.conseils(librarySources);
    if (avis.length) send('conseils', avis);
    if (!librarySources.length) {
      send('status', { ok: false, msg: 'Aucune bibliotheque trouvee — ouvre les reglages' });
      send('library', { n: 0, crates: 0, conseils: avis });
      return;
    }
    /* on privilegie la base du logiciel qui vient de s'ouvrir */
    const ordered = librarySources.slice().sort((a, b) =>
      (b.kind === preferKind ? 1 : 0) - (a.kind === preferKind ? 1 : 0));
    send('status', { ok: true, msg: 'Lecture : ' + ordered.map(s => s.kind).join(', ') });

    const lists = [];
    for (const src of ordered) {
      try { lists.push(await autolib.readSource(src, x => send('progress', x), { cache: SCAN() })); }
      catch (e) { send('status', { ok: false, msg: src.kind + ' : ' + e.message }); }
    }
    const merged = autolib.merge(lists);
    /* On ne fait plus attendre le DJ : la base du logiciel donne
       deja titre, artiste, BPM et tonalite, et c'est tout ce qu'il
       faut pour proposer un enchainement. L'energie et le timbre
       arrivent ensuite, morceau par morceau, sans bloquer. */
    library = libmod.finalize(merged);
    indexChemins = null;
    rebuildClient();
    rebuildCrates(ordered);
    elaguerStructures();
    send('library', { n: library.length, crates: crateList.length,
                      conseils: avis,
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
  /* Une bibliotheque qui se resynchronise ne doit pas tuer
     l'analyse en cours. Les identifiants etant desormais stables,
     recharger revient a comparer deux listes : ce qui est deja
     analyse le reste, seuls les nouveaux venus entrent dans la
     file. Les fils continuent de tourner sans interruption. */
  if (analyse) {
    const r = analyse.charger(library);
    analyse.demarrer();
    prioriserAnalyse();
    send('analysis', { phase: 'analyse', done: 0, total: r.aFaire, restants: r.aFaire,
                       caches: r.caches, demarrage: true });
    return;
  }
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
/* Apres une resynchronisation, on oublie les morceaux qui ne sont
   plus la. Sans ca, la memoire des points de mix garde tout ce que
   le DJ a supprime depuis le lancement de l'app. */
function elaguerStructures() {
  if (!library.length) return;
  const vivants = new Set(library.map(t => t.id));
  for (const id of Array.from(structures.keys())) if (!vivants.has(id)) structures.delete(id);
}

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

/* La cloture a epingler maintenant, ou rien. Le resultat est garde
   pour que le widget puisse dire au DJ qu'elle a change. */
let clotureRevue = null;
function clotureEpinglee(vivier, ph) {
  if (!ph || !ph.liberer || !landPlan || !landPlan.closer || !current) { clotureRevue = null; return null; }
  const r = landing.clotureMaintenant(landPlan, current, vivier, {
    playedIds: setlog ? setlog.playedIds() : new Set(),
    banned: bannedSet(), wanted: clientSet.wanted
  });
  clotureRevue = r;
  return r && r.track ? r.track.id : null;
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

/* ------------------------------------------------------------
   La courbe, observee plutot que declaree.

   Le DJ devait appuyer sur MONTER, TENIR ou BAISSER. Personne ne
   le fait : on est en cabine, on mixe, on ne va pas cliquer un
   bouton pour annoncer une intention qui se lit deja dans les six
   derniers morceaux joues. En mode automatique, Liaison regarde la
   pente reelle de l'energie et suit.
   ------------------------------------------------------------ */
function arcAuto() {
  const joues = setlog && setlog.current ? setlog.current.played : [];
  return leGout().arcObserve(joues);
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
  const arc = ph ? ph.arc : (config.arc === 'auto' ? (arcAuto() || 'hold') : config.arc);

  /* Ce que Liaison a appris de ce DJ. Neutre les douze premiers
     enchainements, puis de plus en plus present. */
  const g = leGout().reglages();

  const bruts = engine.suggest(current, vivier, {
    dna: currentDNA(), arc: arc, mode: mode,
    poids: g.poids, marge: g.marge, variete: g.variete,
    banned: bannedSet(), wanted: clientSet.wanted,
    trends: trends, limit: n,
    /* la memoire de la soiree : ce qui vient d'etre joue */
    recent: setlog && setlog.current ? setlog.current.played : [],
    avancement: ph && landPlan ? 1 : 0,
    /* quand l'heure de la cloture est venue, on la fait remonter —
       apres avoir verifie qu'elle est encore mixable depuis ce qui
       tourne, et en la remplacant si elle ne l'est plus */
    epingle: clotureEpinglee(vivier, ph)
  });

  /* On garde les propositions BRUTES : ce sont elles qui portent
     les notes par critere, et donc l'etiquette dont l'apprentissage
     a besoin au prochain changement de morceau. */
  dernieresPropositions = bruts;

  return bruts.map(r => {
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
      cloture: !!r.cloture,
      /* « tu l'as deja passe » : ce soir, ou une autre fois au meme endroit */
      deja: setlog ? setlog.lastPlay(r.track.id, { sameName: config.sessionName }) : null
    };
  });
}

function setCurrent(track, how) {
  /* ------------------------------------------------------------
     Le seul moment ou Liaison apprend quelque chose.

     Le DJ vient de lancer un morceau. Soit c'est l'un de ceux
     qu'on proposait — on avait raison —, soit c'est autre chose,
     et c'est la que l'information est la plus riche : il nous dit
     gratuitement ce qu'on avait mal note.

     On observe TOUJOURS, meme quand le widget est ferme, meme
     quand le DJ ne regarde pas. C'est ce qui permet de l'ouvrir au
     milieu de la nuit et de le trouver deja au courant.
     ------------------------------------------------------------ */
  try {
    if (current && track && current.id !== track.id) {
      leGout().observer({
        cur: current, joue: track,
        propositions: dernieresPropositions,
        recents: setlog && setlog.current ? setlog.current.played : [],
        dna: currentDNA(),
        arc: config.arc === 'auto' ? (arcAuto() || 'hold') : config.arc
      });
    }
  } catch (e) { /* apprendre ne doit jamais empecher de jouer */ }

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
/* ============================================================
   rekordbox sans materiel.

   Pro DJ Link ne parle que si un CDJ, un XDJ ou un DJM est sur le
   reseau. Le DJ qui essaie Liaison chez lui, devant rekordbox
   seul, n'a donc jamais rien vu bouger : « en attente du deck »,
   indefiniment, sans que rien ne soit casse.

   On ajoute une deuxieme paire d'yeux : les fichiers audio que le
   processus rekordbox tient ouverts. C'est une deduction et pas
   une annonce — voir sources/rekordbox.js pour ce qu'elle vaut —
   donc elle passe TOUJOURS apres Pro DJ Link. Des qu'un vrai
   paquet cabine arrive, on cesse de deduire.
   ============================================================ */
let rbWatch = null;
let dernierPaquetDeck = 0;
let indexChemins = null;

function chemins() {
  if (indexChemins) return indexChemins;
  indexChemins = new Map();
  for (const t of library) if (t.path) indexChemins.set(libmod.cleChemin(t.path), t);
  return indexChemins;
}

function startRekordboxFichiers() {
  stopRekordboxFichiers();
  /* On demarre AUSSI sous Windows, ou le module se contente
     d'expliquer pourquoi il ne peut rien lire. On sortait ici sans
     rien dire : le DJ Windows n'avait donc ni detection ni
     explication — juste un widget muet. */
  rbWatch = rbFichiers.start({
    resoudre: p => chemins().get(libmod.cleChemin(p)) || null
  }, {
    onLoad: x => {
      /* Pro DJ Link a parle il y a moins d'une minute : c'est lui
         qui commande, on se tait. */
      if (Date.now() - dernierPaquetDeck < 60000) return;
      if (!current || current.id !== x.track.id) setCurrent(x.track, 'rekordbox');
    },
    onStatus: s => {
      if (s && s.conseil) send('conseils', [s.conseil]);
    }
  });
}
function stopRekordboxFichiers() {
  if (rbWatch) { try { rbWatch.stop(); } catch (e) {} rbWatch = null; }
}

now.on('status', s => {
  send('status', s);
  /* Une source qui sait pourquoi elle ne voit rien le dit au
     widget, pas seulement au bandeau d'etat. */
  if (s && s.conseil) send('conseils', [s.conseil]);
});

/* Pro DJ Link : un morceau vient d'etre charge sur un deck */
now.on('deck', st => {
  dernierPaquetDeck = Date.now();
  const t = library.find(x => x.rbId && x.rbId === st.trackId);
  if (t) { if (!current || t.id !== current.id) setCurrent(t, 'deck ' + st.device); }
  else send('raw', { text: 'Deck ' + st.device + ' — identifiant rekordbox ' + st.trackId, matched: null });
});

/* ---------------- IPC ---------------- */
ipcMain.handle('locales:pack', (e, country, event) => locales.compose(country, event));
ipcMain.handle('config:get', () => ({ config: config, version: app.getVersion(), countries: locales.COUNTRIES, events: locales.EVENTS, libraryCount: library.length,
  detected: autolib.detect(), running: watcher.current().map(a => ({ id: a.id, label: a.label })),
  /* La licence n'existe qu'apres app.whenReady(). Une fenetre ne
     peut pas interroger avant, en principe — mais « en principe »
     ne suffit pas pour une ligne qui, si elle jette, empeche
     l'interface entiere de s'initialiser. */
  license: license ? license.status() : null,
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

/* ------------------------------------------------------------
   Ce que Liaison a appris, en clair.

   Un systeme qui s'adapte en silence est un systeme auquel on ne
   fait pas confiance — et que le DJ soupconnera au premier
   enchainement rate, a tort. On rend donc l'apprentissage lisible
   et effacable : des phrases en francais, et un bouton pour tout
   oublier.
   ------------------------------------------------------------ */
ipcMain.handle('gout:etat', () => {
  const g = leGout();
  const r = g.reglages();
  return {
    n: g.d.n, pris: g.d.pris, ignore: g.d.ignore, force: Math.round(r.force * 100),
    mini: 12, resume: g.resume(),
    arcObserve: arcAuto(),
    marge: r.marge ? Math.round(r.marge * 1000) / 10 : null
  };
});
ipcMain.handle('gout:oublier', () => { leGout().oublier(); return { ok: true }; });

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
    importing: importing,
    /* Ce qui manque pour aller vite. Recalcule a chaque appel :
       le DJ peut exporter son XML pendant que le widget est
       ouvert, et le conseil doit alors disparaitre tout seul. */
    conseils: autolib.conseils(librarySources)
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
    recent: setlog && setlog.current ? setlog.current.played : [],
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
  landPlan && landPlan.ok
    ? Object.assign({}, landPlan, { phase: landingNow(), revue: clotureRevue })
    : null);

ipcMain.handle('landing:clear', () => {
  landPlan = null; landAt = 0;
  if (current) send('suggestions', computeSuggestions(config.suggestCount || 3));
  return { ok: true };
});

/* ============================================================
   La sante de la bibliotheque
   ============================================================ */
ipcMain.handle('health:scan', (e, opt) => {
  const b = health.bilan(library, { verifierFichiers: !!(opt && opt.fichiers) });
  return Object.assign(b, {
    /* l'analyse de fond avance pendant qu'on regarde : on donne
       son etat pour que le bilan se lise avec la bonne reserve */
    enCours: analyse ? analyse.file.size : 0,
    horsLigne: analyse ? analyse.compterAbsents() : 0
  });
});

/* Ouvrir le fichier dans le Finder : le geste qui suit le constat. */
ipcMain.handle('health:reveal', (e, id) => {
  const t = library.find(x => x.id === id);
  if (!t || !t.path) return { ok: false };
  try { shell.showItemInFolder(t.path); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});

/* ============================================================
   Le mode preparation
   ============================================================ */
let dernierePrepa = null;

ipcMain.handle('prepare:build', (e, opt) => {
  opt = opt || {};
  const tam = currentFilter();
  /* ce qui a deja ete joue dans une soiree du meme nom */
  const eviter = new Set();
  if (opt.eviterDejaJoues && setlog) {
    const nom = String(config.sessionName || '').trim().toLowerCase();
    for (const s of setlog.sets) {
      if (nom && String(s.name || '').trim().toLowerCase() !== nom) continue;
      for (const p of s.played) eviter.add(p.id);
    }
  }
  dernierePrepa = prepare.preparer({
    library: tam.tracks.tracks,
    dureeMin: Number(opt.minutes) || 0,
    pack: locales.byId(config.pack),
    dna: currentDNA(),
    wanted: clientSet.wanted,
    banned: bannedSet(),
    eviterIds: eviter,
    marge: Number(opt.marge) || 1.6
  });
  return dernierePrepa;
});

ipcMain.handle('prepare:export', async (e, opt) => {
  if (!dernierePrepa || !dernierePrepa.ok) return { ok: false, error: 'Rien a exporter.' };
  const format = (opt && opt.format) === 'txt' ? 'txt' : 'm3u8';
  const nom = String(config.sessionName || 'Preparation').replace(/[\/\\:*?"<>|]/g, '-').slice(0, 50);
  const r = await dialog.showSaveDialog({
    title: 'Enregistrer la preparation',
    defaultPath: nom + ' - ' + dernierePrepa.duree + ' min.' + format,
    filters: [format === 'm3u8'
      ? { name: 'Playlist a importer', extensions: ['m3u8', 'm3u'] }
      : { name: 'Texte', extensions: ['txt'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(r.filePath,
      format === 'm3u8' ? prepare.m3u(dernierePrepa) : prepare.texte(dernierePrepa, config.sessionName),
      'utf8');
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
  return { ok: true, path: r.filePath, n: dernierePrepa.ordre.length };
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
    /* reshuffle ne comprend que up/hold/down : « auto » doit etre
       resolu ici, sinon il tombe dans le cas par defaut sans qu'on
       le sache. */
    dna: currentDNA(), arc: config.arc === 'auto' ? (arcAuto() || 'hold') : config.arc, drop: opts.drop || 0,
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
ipcMain.handle('license:status', () => (license ? license.status() : null));
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

/* ------------------------------------------------------------
   Relire, et la difference entre les deux boutons.

   « Relire » compare les fichiers a ce qu'on connait deja : ceux
   qui n'ont pas bouge ne sont pas rouverts. Dix titres achetes
   cet apres-midi coutent dix lectures, pas vingt-deux mille.

   « Tout relire » jette le cache et repart de zero. Utile dans un
   seul cas, mais reel : un logiciel qui recrit les tags d'un
   morceau SANS changer sa date de modification — ca arrive avec
   certains outils de retagage. Le morceau parait inchange alors
   qu'il ne l'est plus. On garde donc la porte de sortie, en
   disant ce qu'elle coute.
   ------------------------------------------------------------ */
ipcMain.handle('library:rescan', async (e, opt) => {
  if (opt && opt.force) { try { fs.unlinkSync(SCAN()); } catch (err) {} }
  await autoImport(activeApp && activeApp.librarySource);
  return { n: library.length };
});

/* Ce que le cache de lecture contient — pour dire au DJ ce qu'une
   relecture va reellement lui couter. */
ipcMain.handle('library:scanInfo', () => {
  let n = 0, taille = 0;
  try { taille = fs.statSync(SCAN()).size; } catch (err) {}
  try { n = Object.keys(libmod.chargerScanCache(SCAN()).e).length; } catch (err) {}
  return { connus: n, octets: taille, dossiers: librarySources.filter(s => s.kind === 'folder').length };
});
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
    /* Un testeur qui a vu quelque chose d'anormal doit pouvoir
       nous envoyer le journal sans avoir a le chercher dans un
       dossier systeme cache. Deux clics depuis la barre de menus. */
    { label: 'Ouvrir le journal des pannes', click: () => {
        const f = path.join(DIR(), 'pannes.log');
        try { if (!fs.existsSync(f)) fs.writeFileSync(f, 'Aucune panne enregistree. Tant mieux.\n'); } catch (e) {}
        try { shell.showItemInFolder(f); } catch (e) {}
      } },
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
    /* rekordbox : on ecoute le reseau ET les fichiers ouverts.
       Sous Windows la seconde source n'existe pas — elle le dit
       elle-meme, ce qui vaut mieux qu'un widget muet. */
    if (kind === 'prolink') startRekordboxFichiers(); else stopRekordboxFichiers();
    if (config.autoLibrary && !library.length) await autoImport(app_.librarySource);
    refreshTray();
  });
  watcher.on('close', app_ => {
    if (activeApp && activeApp.id === app_.id) {
      activeApp = null;
      now.stop();
      stopRekordboxFichiers();
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
/* ============================================================
   Le filet, sous tout le reste.

   Dans le processus principal d'Electron, une exception qui
   n'est attrapee nulle part TUE l'application. Pas de message,
   pas de trace : la fenetre disparait, l'icone de la barre de
   menus disparait, et le DJ ne peut rien raconter d'autre que
   « ca s'est fermé tout seul ». C'est la pire panne possible
   pendant une soiree, et la plus difficile a corriger apres coup
   puisqu'il ne reste rien.

   On attrape donc tout, et on fait trois choses dans cet ordre :

     1. on ECRIT la panne dans un fichier, avec l'heure, la
        version et la trace complete. C'est ce qu'on demandera au
        testeur ;
     2. on NE QUITTE PAS. Une suggestion ratee ne doit pas couper
        la musique — le reste de l'app continue de tourner ;
     3. on le dit une fois, calmement, avec le chemin du journal.
        Une fois seulement : une boucle d'erreurs ne doit pas
        ensevelir l'ecran sous les fenetres.
   ============================================================ */
let dejaPrevenu = false;
function noterPanne(quoi, err) {
  const t = new Date().toISOString();
  const trace = err && err.stack ? err.stack : String(err);
  const ligne = '\n[' + t + '] ' + quoi + ' — Liaison ' + app.getVersion() +
                ' — ' + process.platform + '/' + process.arch + '\n' + trace + '\n';
  /* Le dossier existe toujours en usage reel — Electron le cree —
     mais un journal de pannes qui depend de cette hypothese est un
     journal qu'on ne trouvera pas le jour ou elle est fausse. */
  try { fs.mkdirSync(DIR(), { recursive: true }); } catch (e) {}
  try { fs.appendFileSync(path.join(DIR(), 'pannes.log'), ligne); } catch (e) {}
  try { console.error(ligne); } catch (e) {}
  if (dejaPrevenu) return;
  dejaPrevenu = true;
  try {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Liaison a rencontre un probleme',
      message: 'Liaison continue de tourner.',
      detail: 'Un incident a ete note. Si quelque chose ne repond plus, ferme et rouvre l\'app.\n\n' +
              'Le detail est dans :\n' + path.join(DIR(), 'pannes.log'),
      buttons: ['Continuer', 'Ouvrir le journal'],
      defaultId: 0, cancelId: 0
    }).then(r => { if (r && r.response === 1) { try { shell.showItemInFolder(path.join(DIR(), 'pannes.log')); } catch (e) {} } })
      .catch(() => {});
  } catch (e) {}
}
process.on('uncaughtException', e => noterPanne('exception non attrapee', e));
process.on('unhandledRejection', e => noterPanne('promesse rejetee', e));

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
