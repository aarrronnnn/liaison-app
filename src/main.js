'use strict';
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, screen, Tray, Menu, nativeImage, globalShortcut, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

const engine = require('./engine');
const repertoire = require('./repertoire');
const libmod = require('./library');
const lib = libmod;
const locales = require('./locales');
const { NowPlaying } = require('./sources');
const { GuestServer, SetLog, qrPNG, shareLinks } = require('./session');
const { reshuffle } = require('./setbuilder');
const autolib = require('./autolibrary');
const exterieur = require('./exterieur');
const incidents = require('./incidents');
const { AppWatcher } = require('./watcher');
const { StructurePool, StructureCache } = require('./structure');
const { AnalysisService } = require('./analysis');
const health = require('./health');
const prepare = require('./prepare');
const clientlist = require('./clientlist');
const cratesmod = require('./crates');
const filtersmod = require('./filters');
let dernierImport = null;   /* compte rendu du dernier import, pour le diagnostic */
const genresmod = require('./genres');
const dossiersmod = require('./dossiers');
const aavoir = require('./aavoir');
const charts = require('./charts');
const landing = require('./landing');
const acquire = require('./acquire');
const ecrire = require('./ecrire');
const maj = require('./maj');
const moments = require('./moments');
const debriefmod = require('./debrief');
const TRAY_ICON = require('./tray-icon');
const { License, TIERS, API } = require('./license');
const rbFichiers = require('./sources/rekordbox');
const { Gout } = require('./gout');
const { Soirees } = require('./soirees');

const DIR = () => app.getPath('userData');
const CFG = () => path.join(DIR(), 'config.json');
const CACHE = () => path.join(DIR(), 'analysis-cache.json');
const SETS = () => path.join(DIR(), 'sets.json');
/* Le journal des titres reclames et absents. Il survit aux
   soirees : c'est tout son interet. */
const AAVOIR = () => path.join(DIR(), 'a-avoir.json');
const LIC = () => path.join(DIR(), 'license.json');
const STRUCT = () => path.join(DIR(), 'structure-cache.json');
/* Ce que Liaison a appris de CE DJ. Un fichier a part : on peut
   l'effacer sans rien perdre d'autre. */
const GOUT = () => path.join(DIR(), 'gout.json');
/* Les fiches de soiree preparees a l'avance. */
const SOIREES = () => path.join(DIR(), 'soirees.json');
/* Les tags lus par ffprobe, gardes d'une soiree a l'autre : sans ce
   fichier, un dossier de 22 000 morceaux est relu en entier a chaque
   lancement. */
const SCAN = () => path.join(DIR(), 'scan-cache.json');

const DEFAULTS = {
  source: null, sourceOpts: {},
  autoLibrary: true, autoWidget: true, launchAtLogin: true, prolinkAnnounce: false,
  /* undefined tant que la question n'a pas ete posee : c'est ce qui
     distingue « il n'a pas encore repondu » de « il a dit non ».
     Aucun envoi dans les deux cas — la valeur par defaut est le
     silence. */
  rapportPannes: undefined,
  libraryMode: null, libraryPath: null,
  /* les dossiers que le DJ a montres du doigt : des sources EN PLUS */
  dossiers: [],
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
  /* Les filtres d'instant. Ils ne sont PAS sauvegardes : ils vivent
     le temps d'un morceau et retombent quand le suivant part. Les
     mettre dans le fichier de configuration reviendrait a les
     retrouver le lendemain soir sans savoir d'ou ils sortent. */
  fGenres: [], fMarge: 0, fEnergyMin: 0, fEnergyMax: 0,
  /* ------------------------------------------------------------
     Les classements exterieurs.

     Eteints tant qu'aucune cle n'est saisie : Liaison n'invente
     jamais un classement, et une liste codee en dur serait fausse
     en trois semaines. Voir charts.js pour l'accord Last.fm.
     ------------------------------------------------------------ */
  /* « liaison » : le relais liaisondj.app, qui garde la cle et
     mutualise le cache. « lastfm » et « deezer » restent pour le
     depannage depuis une machine de developpement. */
  chartsFournisseur: 'liaison', chartsCle: '',
  /* Le pays du classement. Vide = suivre le contexte de la soiree,
     ce qui est le bon defaut ; un code pays le force, pour la date
     a l'etranger. */
  chartsPays: '',
  /* nuit par defaut : une cabine est sombre */
  theme: 'nuit',
  /* La hauteur du widget, au choix du DJ : barre / cabine / grand.
     C'est un reglage de meuble, pas un filtre — celui qui mixe en
     plein ecran doit retrouver sa reglette le lendemain soir. */
  densite: 'cabine'
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
let soirees = null;
const lesSoirees = () => (soirees || (soirees = new Soirees(SOIREES())));
/* Ce qu'on proposait juste avant le changement de morceau : c'est
   l'etiquette de l'exemple qu'on est en train d'observer. */
let dernieresPropositions = [];
/* ------------------------------------------------------------
   Ce que la salle reclame — la « tendance », mesuree ici et ce soir.

   Cette carte etait declaree et jamais remplie : le critere de
   tendance rendait donc la constante 20 pour tous les morceaux, le
   badge TENDANCE du widget ne pouvait jamais s'allumer, et le mode
   « tendance » — pourtant facture dans les paliers superieurs —
   ne changeait strictement rien.

   Plutot que de la retirer, on lui donne la seule source de
   tendance qui soit honnete et verifiable : les demandes des
   invites de CETTE soiree. Pas un classement Spotify mondial qui
   ne sait rien du mariage en cours ; les gens qui sont dans la
   salle, maintenant. Deux telephones qui demandent le meme titre,
   c'est un signal ; huit, c'est un ordre.
   ------------------------------------------------------------ */
let trends = new Map();
/* ------------------------------------------------------------
   Le journal des manques.

   Charge une fois au demarrage, reecrit quand il change. Il est
   volontairement separe de sets.json : les tracklists sont
   l'histoire des soirees, ce journal est une liste de courses.
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   Le classement, garde en memoire quelques heures.

   Il se charge desormais tout seul a l'ouverture de la rubrique —
   le DJ ne doit pas avoir a cliquer pour voir ce qui manque. Mais
   « tout seul » ne veut pas dire « a chaque fois » : un classement
   national ne bouge pas entre deux clics, et appeler le service a
   chaque aller-retour dans les reglages serait gaspiller un quota
   qui est celui de l'accord commercial.

   Trois heures, et une entree par pays : le DJ qui compare France
   et Belgique ne repaie pas la France au retour.
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   LE CLASSEMENT DORT SUR LE DISQUE, PAS EN MEMOIRE.

   Premiere version : une carte en memoire, trois heures. Elle
   mourait a chaque fermeture de l'application — donc chaque
   ouverture des reglages redemandait le classement au relais,
   donc au quota de l'accord Last.fm. Et un DJ hors connexion — un
   train, une cave, une salle sans wifi, c'est-a-dire la moitie
   des lieux ou on prepare une soiree — voyait un bloc vide.

   Le classement est donc ECRIT SUR LE DISQUE, une entree par
   pays, et servi de la sans aucun appel. Il n'expire pas tout
   seul : il reste affiche jusqu'a ce que le DJ demande un autre
   pays sans cache, ou qu'il rafraichisse lui-meme.

   LA DISTINCTION QUI FAIT TOUT MARCHER : ce qu'on garde, c'est la
   LISTE BRUTE des titres, pas le resultat. La confrontation avec
   la bibliotheque — « celui-la tu l'as, celui-la non » — est
   refaite a CHAQUE lecture, par aavoir.tamiser(). Un morceau
   telecharge entre deux ouvertures disparait donc de la liste des
   manques immediatement, sans qu'on ait rappele Last.fm une seule
   fois. C'est exactement ce qu'on veut : la donnee exterieure est
   figee, la donnee locale est vivante.
   ------------------------------------------------------------ */
const CLASSEMENTS = () => path.join(DIR(), 'classements.json');
/* Au-dela de dix jours, on ne cache pas que le releve date : le
   panneau le dit et propose de rafraichir. Un « classement du
   moment » vieux de six mois serait un mensonge, meme affiche de
   bonne foi. */
const CHARTS_TIEDE = 10 * 24 * 3600 * 1000;
let chartsDisque = null;

function chargerClassements() {
  if (chartsDisque) return chartsDisque;
  const lu = ecrire.lireJSON(CLASSEMENTS(), null);
  chartsDisque = (lu && typeof lu === 'object') ? lu : {};
  return chartsDisque;
}
/* ------------------------------------------------------------
   UNE ECRITURE QUI ECHOUE DOIT SE VOIR.

   Ce « catch (e) {}  » etait un piege parfait : si l'ecriture
   echoue — disque plein, dossier en lecture seule, antivirus qui
   verrouille — le classement n'est jamais garde, et le symptome
   est exactement celui d'une fonction qui n'existe pas. Le DJ
   relance, la liste a disparu, et rien nulle part ne dit
   pourquoi. C'est la pire categorie de defaut : silencieux et
   indiscernable d'une absence de fonctionnalite.

   On retient donc la panne et on la fait remonter jusqu'au
   panneau, qui la dit en francais.
   ------------------------------------------------------------ */
let classementsEcritKO = null;

function enregistrerClassements() {
  try {
    ecrire.ecrireJSON(CLASSEMENTS(), chargerClassements());
    classementsEcritKO = null;
    return true;
  } catch (e) {
    classementsEcritKO = String((e && e.message) || e);
    console.warn('[liaison] impossible de garder le classement sur le disque :', classementsEcritKO);
    return false;
  }
}

let journalManques = null;
/* Le journal s'ecrit APRES coup, pas a chaque demande : a 1 h du
   matin les telephones arrivent en rafale, et reecrire un fichier
   a chaque validation est exactement le genre de detail qui fait
   ramer le widget au pire moment. */
let journalSale = false;
/* .unref() : sans lui, ce minuteur tient l'evenement en vie a lui
   tout seul. Le banc de demarrage, qui se contente de charger
   main.js et de rendre la main, ne s'arretait plus — il a fallu
   l'interrompre au bout de deux minutes. Un minuteur d'entretien
   ne doit jamais empecher un processus de finir. */
const _minuteurJournal = setInterval(() => {
  if (journalSale) { journalSale = false; enregistrerJournal(); }
}, 20000);
if (_minuteurJournal.unref) _minuteurJournal.unref();

/* L'identifiant de la fiche de soiree armee, quand il y en a une :
   c'est ce qui permet de dire « demande dans trois soirees
   differentes » plutot que « demande trois fois ». */
function soireeActiveId() {
  try { const a = lesSoirees().active(); return a ? a.id : null; } catch (e) { return null; }
}
function chargerJournal() {
  if (journalManques) return journalManques;
  const lu = ecrire.lireJSON(AAVOIR(), null);
  journalManques = (lu && typeof lu === 'object') ? lu : {};
  return journalManques;
}
function enregistrerJournal() {
  try { ecrire.ecrireJSON(AAVOIR(), aavoir.elaguer(chargerJournal(), {})); } catch (e) {}
}

/* Recalculee a chaque nouvelle demande, pas a chaque suggestion :
   c'est une douzaine de rapprochements flous, pas gratuits. */
function majTendances() {
  const t = new Map();
  const dem = guests.top();
  if (!dem.length) { trends = t; return; }
  /* Le titre le plus demande de la soiree vaut 100. Les autres se
     situent par rapport a lui, avec un plancher a 35 : etre demande
     du tout est deja un signal. */
  const haut = Math.max(1, dem[0].n);
  for (const r of dem.slice(0, 20)) {
    const m = engine.match((r.artist ? r.artist + ' ' : '') + r.title, library, 0.5);
    if (!m) {
      /* ------------------------------------------------------------
         Rien a proposer CE SOIR — mais tout a dire apres.

         Cette ligne se contentait de « continue », avec le
         commentaire « le DJ ne l'a pas : rien a proposer ». C'est
         vrai pour la nuit en cours et faux pour tout le reste :
         une salle qui reclame un titre absent est l'information la
         plus utile qu'un DJ puisse recevoir, et elle etait
         detruite a chaque demande depuis le premier jour.

         Elle part donc au journal, avec l'identifiant de la soiree
         — c'est le nombre de SOIREES distinctes, plus que le
         nombre de demandes, qui distingue un trou dans la
         bibliotheque d'une tablee insistante.
         ------------------------------------------------------------ */
      aavoir.noter(chargerJournal(), {
        artist: r.artist, title: r.title, n: r.n, at: r.at,
        soiree: (setlog && setlog.current && setlog.current.id) || soireeActiveId() || 'hors-soiree'
      });
      journalSale = true;
      continue;
    }
    const cle = ((m.track.artist || '') + ' - ' + (m.track.title || ''))
      .toLowerCase().replace(/\s+/g, ' ').trim();
    t.set(cle, Math.round(35 + (r.n / haut) * 65));
  }
  trends = t;
}
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
/* Trois fils, pas deux : le morceau en cours et les deux premieres
   suggestions sont ce qui porte l'affichage, et ils doivent partir
   ensemble. Le quatrieme fil, lui, se disputerait le disque avec
   l'analyse de fond. */
const structPool = new StructurePool(3);
/* ------------------------------------------------------------
   Le repertoire du DJ : le centre de gravite de SA bibliotheque,
   et les portes qu'il a ouvertes ce soir en jouant.

   Le centre est calcule a l'import, jamais par suggestion : c'est
   un parcours complet de la bibliotheque.
   ------------------------------------------------------------ */
let repCentre = null;
let repOuvertes = new Set();
let structCache = null;
const structures = new Map();      /* id du morceau -> structure */
const structBusy = new Set();
let structTimer = null;
/* ------------------------------------------------------------
   LA SANTE DES POINTS DE MIX.

   L'analyse de fond compte ses echecs depuis longtemps et sait
   dire au DJ « ffmpeg ne demarre pas chez toi ». Les points de mix,
   eux, echouaient en silence : pas un compteur, pas un message,
   juste un bandeau qui tourne. Un DJ chez qui le calcul de
   structure ne marche pas ne pouvait meme pas le SAVOIR, donc
   encore moins le raconter.
   ------------------------------------------------------------ */
const structSante = { reussis: 0, rates: 0, derniereErreur: null, prevenu: false };

const feat = () => (license ? license.features() : TIERS.trial);

function loadConfig() {
  const lu = ecrire.lireJSON(CFG(), null);
  if (lu && typeof lu === 'object') config = Object.assign({}, DEFAULTS, lu);
  /* Les versions d'avant ecrivaient les filtres d'instant dans le
     fichier. Un DJ qui met Liaison a jour ne doit pas demarrer avec
     un filtre pose il y a trois semaines et qu'il a oublie. */
  config.fGenres = [];
  config.fMarge = 0;
  config.fEnergyMin = 0;
  config.fEnergyMax = 0;
}
/* Les quatre filtres d'instant, nommes une seule fois. Ils sont
   exclus de l'ecriture disque ici, et remis a zero au chargement :
   deux endroits, une seule liste. */
const FILTRES_INSTANT = ['fGenres', 'fMarge', 'fEnergyMin', 'fEnergyMax'];

function saveConfig() {
  /* Ecriture atomique : ce fichier porte les listes du client, saisies
     a la main avant la soiree. Les perdre a cause d'une coupure, c'est
     retaper cent quatre-vingts titres. */
  /* ------------------------------------------------------------
     Ce qui ne doit JAMAIS survivre a la soiree.

     Les filtres d'instant — un genre, une marge de tempo, une
     plage d'energie — sont poses en cours de morceau et retombent
     au morceau suivant. Le commentaire a cote de DEFAULTS le
     promettait deja ; le code ne le tenait pas : saveConfig
     ecrivait `config` en entier, donc un « techno » pose a 1 h du
     matin se retrouvait dans le fichier et revenait le samedi
     suivant. Le DJ ouvre Liaison, ne voit aucune pastille
     allumee — elles sont bien remises a zero a l'affichage — et
     ne comprend pas pourquoi la moitie de sa bibliotheque a
     disparu des propositions.

     On ecrit donc une copie sans eux. C'est le seul endroit ou le
     fichier de configuration s'ecrit : il n'y a pas d'autre porte.
     ------------------------------------------------------------ */
  const surDisque = Object.assign({}, config);
  for (const k of FILTRES_INSTANT) delete surDisque[k];
  ecrire.ecrireJSON(CFG(), surDisque);
}
const send = (ch, payload) => {
  for (const w of [widget, settings]) if (w && !w.isDestroyed()) w.webContents.send(ch, payload);
};

/* ---------------- fenetres ---------------- */
/* ============================================================
   Le widget par-dessus un logiciel en plein ecran.

   Signale sur rekordbox en plein ecran : le widget disparait.
   C'est le cas d'usage NORMAL — un DJ met son logiciel en plein
   ecran, c'est meme la premiere chose qu'il fait. Un widget de
   cabine qu'on ne voit pas pendant qu'on mixe ne sert a rien.

   Trois causes, corrigees ensemble :

   1. Sur macOS, le plein ecran natif cree un ESPACE dedie.
      Une fenetre ordinaire, meme « toujours au-dessus », reste
      dans son espace d'origine : l'utilisateur bascule d'espace
      et la laisse derriere lui. La seule fenetre qui suit est
      une fenetre de type « panel » — c'est ce que sont les
      palettes flottantes des logiciels de creation.

   2. setVisibleOnAllWorkspaces etait pose UNE FOIS, a la
      creation. Or l'appel a show() sur une fenetre masquee, et
      certains changements d'espace, le perdent. On le repose
      donc a chaque affichage.

   3. L'ordre comptait : setAlwaysOnTop apres
      setVisibleOnAllWorkspaces annulait une partie du reglage.
      On finit desormais par la visibilite.

   Et parce qu'aucun de ces trois points n'est garanti sur toutes
   les versions du systeme, un raccourci clavier global ramene le
   widget au premier plan quoi qu'il arrive.
   ============================================================ */
function poserAuDessus(w) {
  if (!w || w.isDestroyed()) return;
  try { w.setAlwaysOnTop(true, 'screen-saver'); } catch (e) {
    try { w.setAlwaysOnTop(true); } catch (e2) {}
  }
  try {
    if (w.setVisibleOnAllWorkspaces)
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  } catch (e) {}
}

function createWidget() {
  const d = screen.getPrimaryDisplay().workArea;
  const mac = process.platform === 'darwin';
  widget = new BrowserWindow({
    /* 548 px etait la hauteur de depart ET la hauteur definitive :
       l'ajustement automatique ne s'est jamais declenche (le corps
       de la page mesurait la fenetre au lieu de son contenu, voir
       widget.html). Maintenant qu'il fonctionne, cette valeur n'est
       plus qu'un point de depart — on part du cran par defaut pour
       eviter que le widget s'ouvre grand puis se retracte sous les
       yeux du DJ. */
    width: 344, height: 400,
    x: d.x + d.width - 372, y: d.y + 40,
    frame: false, resizable: false, maximizable: false, fullscreenable: false,
    /* « panel » : le seul type de fenetre qui flotte au-dessus d'une
       application en plein ecran sur macOS. Ailleurs, le type par
       defaut convient. */
    type: mac ? 'panel' : undefined,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#13161B',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  poserAuDessus(widget);
  widget.loadFile(path.join(__dirname, 'ui', 'widget.html'));
  /* A chaque affichage : le reglage se perd au retour d'un
     masquage ou d'un changement d'espace. */
  widget.on('show', () => poserAuDessus(widget));
  widget.on('closed', () => { widget = null; });
  widget.on('close', e => { if (!app.isQuitting) { e.preventDefault(); widget.hide(); } });
}

/* Le filet : un raccourci qui ramene le widget, meme si le systeme
   a decide de le cacher. Ctrl/Cmd + Maj + L — L comme Liaison, et
   aucune application de mix ne l'utilise. */
function poserRaccourci() {
  const combo = process.platform === 'darwin' ? 'Command+Shift+L' : 'Control+Shift+L';
  try {
    globalShortcut.register(combo, () => {
      if (!widget || widget.isDestroyed()) createWidget();
      poserAuDessus(widget);
      widget.show();
      widget.focus();
    });
  } catch (e) { /* un autre logiciel l'a deja pris : tant pis */ }
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
  /* Meme regle qu'a la detection automatique : ce qui n'est plus sur
     le disque ne doit pas se retrouver dans une proposition. */
  const sansDbl = lib.dedoublonner(tracks);
  const elague = lib.elaguerDisparus(sansDbl.tracks);
  library = lib.finalize(elague.gardes);
  repCentre = repertoire.centre(library);
  elaguerStructures();
  indexChemins = null;
  rebuildClient();
  rebuildCrates([{ kind: mode === 'rekordbox' ? 'rekordbox' : 'folder', path: p }]);
  config.libraryMode = mode; config.libraryPath = p; saveConfig();
  revaliderBulle();
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
    /* ------------------------------------------------------------
       LES DOSSIERS QUE LE DJ A MONTRES DU DOIGT.

       La detection couvre les rangements previsibles ; elle ne
       couvrira jamais « D:\\Mes sons 2024 ». Ces dossiers-la
       arrivent donc ici, EN PLUS des bases trouvees — jamais a
       leur place. Tout le reste de la chaine (fusion, doublons,
       elagage, surveillance) travaille deja sur une liste de
       sources et n'a rien a apprendre.

       Un dossier dont le disque est debranche n'est pas lu ce soir
       et n'est pas non plus efface du reglage : il revient demain.
       ------------------------------------------------------------ */
    const manuels = dossiersmod.lisibles(config.dossiers);
    if (manuels.length) librarySources = librarySources.concat(manuels);
    /* Ce qui manque pour aller vite — typiquement rekordbox
       installe sans export XML. On le dit avant le scan, pas
       apres deux heures. */
    /* Quels logiciels tournent vraiment : c'est ce qui permet de dire
       « Serato est ouvert et je n'ai pas sa bibliotheque » au lieu de
       se taire. */
    let tournent = [];
    try { tournent = watcher.current().map(a => a.id); } catch (e) {}
    const avis = autolib.conseils(librarySources, { tournent: tournent });
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

    /* ------------------------------------------------------------
       UNE SOURCE LUE QUI NE REND RIEN DOIT LE DIRE.

       Un DJ a envoye une capture : « 0 titres prets », avec deux
       bases Serato correctement detectees juste en dessous. Tout
       avait l'air normal — la detection affichait ses trouvailles,
       aucune erreur nulle part — et la seule information utile,
       « ces bases ont ete ouvertes et n'ont donne aucun morceau »,
       n'etait affichee nulle part.

       Une source qui rend zero n'est pas la meme chose qu'une
       source absente, et ne se repare pas pareil. On les separe.
       ------------------------------------------------------------ */
    const lists = [];
    const muettes = [];
    /* Ce que chaque source a donne, garde pour le diagnostic : sans
       ca, « 0 titre » ne dit pas LAQUELLE des sources est vide. */
    dernierImport = { quand: Date.now(), sources: [], retires: 0, doublons: 0, horsLigne: 0 };
    for (const src of ordered) {
      let l = null, err = null;
      try { l = await autolib.readSource(src, x => send('progress', x), { cache: SCAN() }); }
      catch (e) { err = e.message; send('status', { ok: false, msg: src.kind + ' : ' + e.message }); }
      if (!l || !l.length) muettes.push(src);
      lists.push(l || []);
      dernierImport.sources.push({
        kind: src.kind, path: src.path, manuel: !!src.manuel, erreur: err,
        lus: (l || []).length,
        /* trois chemins en exemple, et s'ils designent un fichier :
           c'est ce qui distingue « base vide » de « chemins faux » */
        exemples: (l || []).slice(0, 3).map(t => ({
          path: t.path,
          existe: (() => { try { return !!t.path && fs.statSync(t.path).isFile(); } catch (e) { return false; } })()
        }))
      });
    }
    if (muettes.length) {
      send('conseils', [{
        cle: 'source-muette', quand: 'import',
        titre: muettes.length === 1
          ? 'Une source a ete lue mais n\'a donne aucun morceau'
          : muettes.length + ' sources ont ete lues sans donner un seul morceau',
        texte: 'Liaison a bien trouve ' + muettes.map(s => s.label || s.kind).join(', ') +
               ' et a pu l\'ouvrir, mais rien n\'en est sorti. Ce n\'est donc pas un probleme ' +
               'de detection : soit la base est vide, soit les fichiers qu\'elle designe ne sont ' +
               'pas la ou elle le dit — un disque debranche, par exemple.',
        marche: ['Verifie que le disque qui porte ta musique est bien branche',
                 'Reglages > Bibliotheque > Tout relire',
                 'Sinon, ajoute le dossier de ta musique a la main'],
        repli: 'Les autres sources, elles, ont ete lues normalement.'
      }]);
    }
    const merged = autolib.merge(lists);
    /* ------------------------------------------------------------
       Ce que le DJ a supprime, retire de la bibliotheque.

       Les bases des logiciels de mix ne se vident pas toutes
       seules — un export rekordbox est une photo prise un jour
       donne, et iTunes garde une entree pour un fichier qu'on a
       mis a la corbeille il y a six mois. Liaison lisait donc des
       lignes qui ne designent plus rien, et les proposait toute la
       nuit.

       On verifie une fois, a l'import : si le volume repond et que
       le fichier n'y est pas, il est parti. On le dit — un DJ qui
       voit « 340 titres retires » comprend tout de suite que son
       export date ; s'il n'en voyait rien, il croirait a un bug.
       ------------------------------------------------------------ */
    /* ------------------------------------------------------------
       Le meme morceau dans deux bibliotheques.

       merge() a deja replie ce qui partage un chemin. Ici on replie
       ce qui partage une chanson : deux FICHIERS differents, meme
       artiste, meme titre, meme duree. C'est le cas du DJ qui a
       iTunes ET rekordbox — iTunes copie dans son dossier media
       pendant que rekordbox garde l'original.
       ------------------------------------------------------------ */
    const sansDoublons = libmod.dedoublonner(merged);
    if (sansDoublons.replies)
      send('status', { ok: true, msg: sansDoublons.replies +
        ' doublon' + (sansDoublons.replies > 1 ? 's' : '') + ' replie' +
        (sansDoublons.replies > 1 ? 's' : '') + ' (meme morceau dans deux bibliotheques)' });
    const elagage = libmod.elaguerDisparus(sansDoublons.tracks);
    if (dernierImport) {
      dernierImport.retires = elagage.disparus.length;
      dernierImport.doublons = sansDoublons.replies || 0;
      dernierImport.horsLigne = elagage.horsLigne || 0;
      dernierImport.gardes = elagage.gardes.length;
    }
    if (elagage.disparus.length)
      send('status', { ok: true, msg: elagage.disparus.length +
        ' titre' + (elagage.disparus.length > 1 ? 's' : '') + ' retire' +
        (elagage.disparus.length > 1 ? 's' : '') + ' : fichier introuvable' });
    /* On ne fait plus attendre le DJ : la base du logiciel donne
       deja titre, artiste, BPM et tonalite, et c'est tout ce qu'il
       faut pour proposer un enchainement. L'energie et le timbre
       arrivent ensuite, morceau par morceau, sans bloquer. */
    library = libmod.finalize(elagage.gardes);
    repCentre = repertoire.centre(library);
    indexChemins = null;
    /* La base du logiciel de mix est reecrite en pleine soiree des
       que le DJ ajoute un morceau, et cette relecture est
       automatique. La bulle doit y survivre : on verifie que son
       ancrage existe encore, on ne l'efface pas par principe. */
    revaliderBulle();
    rebuildClient();
    rebuildCrates(ordered);
    elaguerStructures();
    send('library', { n: library.length, crates: crateList.length,
                      conseils: avis,
                      retires: elagage.disparus.length,
                      doublons: sansDoublons.replies,
                      horsLigne: elagage.horsLigne,
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
    reinscrireHors();
    analyse.demarrer();
    prioriserAnalyse();
    if (current) envoyerNow();
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
    onTrack: (t) => {
      /* ------------------------------------------------------------
         L'app doit PARLER quand elle n'y arrive pas.

         « Aucune reaction de l'app et aucun message. » Quand
         l'analyse echouait, Liaison posait energie 5 partout et se
         taisait. On verifie donc regulierement sa sante, et on
         remonte la panne au widget avec la vraie erreur.
         ------------------------------------------------------------ */
      try {
        const p = analyse && analyse.panne();
        if (p && p.cle !== dernierePanne) {
          dernierePanne = p.cle;
          send('conseils', [{ cle: p.cle, quand: 'biblio',
            titre: p.quoi, texte: p.pourquoi, marche: p.quoiFaire,
            repli: 'Sans analyse, Liaison n\'a ni tempo ni energie : ses propositions ' +
                   'perdent leurs deux criteres les plus lourds.' }]);
          send('toast', { texte: p.quoi, rouge: true });
        }
      } catch (e) { /* signaler ne doit jamais empecher de jouer */ }
      /* Le morceau qui tourne vient d'etre mesure : son tempo, sa
         tonalite et son energie viennent d'apparaitre. L'en-tete
         les montre, il doit donc repartir tout de suite — sans
         attendre le regroupement des quatre secondes. */
      if (t && current && t.id === current.id) { envoyerNow(); prioriserAnalyse(); }
      scheduleResuggest();
    }
  });
  const r = analyse.charger(library);
  reinscrireHors();
  send('analysis', { phase: 'analyse', done: 0, total: r.aFaire, restants: r.aFaire,
                     caches: r.caches, demarrage: true });
  /* Liaison a change sa facon de mesurer : le cache a ete jete, tout
     est a reecouter. On le DIT, sinon le DJ voit une analyse repartir
     de zero sans raison et croit a une panne. */
  if (r.mesurePerimee) {
    send('conseils', [{ cle: 'mesure-refaite', quand: 'biblio',
      titre: 'Liaison reecoute ta bibliotheque',
      texte: 'Cette version mesure l\'energie, la densite, le tempo et la tonalite ' +
             'autrement — et beaucoup mieux. Les anciens resultats ne sont plus ' +
             'comparables, ils ont donc ete jetes plutot que melanges aux nouveaux.',
      marche: ['Rien a faire : ca tourne en fond',
               'Le morceau que tu lances passe devant tout le monde, il est pret en quelques secondes'],
      repli: 'Une grosse bibliotheque demande quelques heures pour etre entierement reecoutee.' }]);
  }
  analyse.demarrer();
  prioriserAnalyse();
}

let dernierePanne = null;
let resugTimer = null;
function scheduleResuggest() {
  if (resugTimer || !current) return;
  resugTimer = setTimeout(() => {
    resugTimer = null;
    if (current) send('suggestions', computeSuggestions(config.suggestCount));
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
    return;
  }
  /* ------------------------------------------------------------
     Et quand le morceau en cours n'a PAS de tempo ?

     Cette fonction ne priorisait alors plus rien du tout : elle
     sortait apres avoir demande le morceau en cours, et laissait
     l'analyse avaler quarante mille titres dans l'ordre d'arrivee.
     Or c'est exactement le cas ou le DJ a le plus besoin d'aide —
     sans tempo nulle part, le moteur est aveugle et propose au
     hasard, ce qu'Aaron a vu sur « Daddy Cool ».

     On prend donc les cent premiers du vivier reellement filtre :
     ce sont ceux que le moteur peut proposer maintenant.
     ------------------------------------------------------------ */
  if (!current) return;
  try {
    const tam = currentFilter();
    const vivier = tam.tracks.tracks;
    const ids = [];
    for (const t of vivier) {
      if (t.id === current.id || t.analyzed || t.offline) continue;
      ids.push(t.id);
      if (ids.length >= 100) break;
    }
    if (ids.length) analyse.prioriser(ids, 1);
  } catch (e) { /* prioriser ne doit jamais empecher de jouer */ }
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
  const vivants = new Map(library.map(t => [t.id, t]));
  for (const id of Array.from(structures.keys())) {
    const t = vivants.get(id);
    if (!t) { structures.delete(id); continue; }
    /* ------------------------------------------------------------
       LE MORCEAU RETAGUE GARDAIT SA VIEILLE STRUCTURE.

       ensureStructure() sort immediatement si structures.has(id), et
       l'identifiant est calcule sur le CHEMIN : il ne change pas
       quand le fichier, lui, change. Un DJ qui reconvertit un
       morceau, le retague ou le remplace par une meilleure version
       en pleine soiree gardait donc les points de mix de l'ancien
       fichier jusqu'au redemarrage — des reperes justes pour un
       fichier qui n'existe plus.

       Le cache disque, lui, est bien indexe sur la date du fichier.
       On lui demande donc la cle courante et on jette de la memoire
       ce qui ne correspond plus.
       ------------------------------------------------------------ */
    if (!structCache || !t.path) continue;
    const st = structures.get(id);
    if (st && st.__cle && st.__cle !== structCache.key(t)) structures.delete(id);
  }
}

function rebuildCrates(sources) {
  /* ------------------------------------------------------------
     Une lecture ratee ne relache pas le filtre du DJ.

     Sur exception, la liste etait vidée — puis, plus bas, le filtre
     de crate etait remis a null ET SAUVEGARDE. Scenario reel : un DJ
     de mariage coche « seulement Vin d'honneur » avant le service ;
     un reimport automatique se declenche (Serato reecrit sa base des
     qu'on ajoute un titre) ; la lecture rate une fois ; le filtre
     saute sans un mot et le moteur repropose toute la bibliotheque
     pendant le repas.

     On garde donc l'ancienne liste quand la lecture echoue : mieux
     vaut une liste un peu vieille qu'un filtre efface.
     ------------------------------------------------------------ */
  try { crateList = cratesmod.readAll(sources || librarySources, library); }
  catch (e) { return; }
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
function ensureStructure(track, priorite) {
  if (!track || !track.path || structures.has(track.id) || structBusy.has(track.id)) return;
  if (structCache) {
    const hit = structCache.get(track);
    if (hit) {
      try { hit.__cle = structCache.key(track); } catch (e) {}
      structures.set(track.id, hit);
      return;
    }
  }
  structBusy.add(track.id);
  structPool.run(track.path, track.bpm, { priorite: priorite || 0, cle: track.id })
    .then(r => {
      /* La cle du fichier voyage avec la structure : c'est elle qui
         permet a elaguerStructures() de reperer un fichier remplace. */
      if (structCache && track.path) { try { r.__cle = structCache.key(track); } catch (e) {} }
      structures.set(track.id, r);
      structSante.reussis++;
      if (structCache) { structCache.set(track, r); structCache.save(); }
      scheduleStructRefresh();
    })
    /* ------------------------------------------------------------
       Un echec qui ne dit pas pourquoi est un bandeau « en cours de
       calcul » a vie.

       On rangeait { ok: false } sans un mot. planFor() rendait null,
       et le widget — qui ne sait pas distinguer « pas encore » de
       « jamais » — affichait « Points de mix en cours de calcul… »
       pour le reste de la soiree. Le motif remonte maintenant
       jusqu'a la ligne, en francais.
       ------------------------------------------------------------ */
    .catch(e => {
      const msg = String((e && e.message) || '');
      /* Un abandon volontaire — le morceau n'est plus propose — n'est
         pas une panne : le compter ferait crier l'app un soir ou le
         DJ enchaine vite. */
      if (!/abandonnee/.test(msg)) {
        structSante.rates++;
        structSante.derniereErreur = msg.slice(0, 200);
        annoncerPanneStructure();
      }
      structures.set(track.id, {
        ok: false,
        abandonne: /abandonnee/.test(msg),
        note: /aucun fil/.test(msg) ? 'Points de mix indisponibles sur cette machine'
            : /delai depasse/.test(msg) ? 'Fichier trop lent a lire — points de mix abandonnes'
            : /abandonnee/.test(msg) ? null
            : 'Liaison n\'a pas pu lire ce fichier'
      });
      scheduleStructRefresh();
    })
    .then(() => { structBusy.delete(track.id); });
}

/* Vingt tentatives avant de crier : un fichier abime isole ne
   prouve rien, vingt echecs sur vingt-cinq sont une panne. */
function annoncerPanneStructure() {
  if (structSante.prevenu) return;
  const tentes = structSante.rates + structSante.reussis;
  if (tentes < 20 || structSante.rates < tentes * 0.8) return;
  structSante.prevenu = true;
  send('conseils', [{
    cle: 'structure-echoue', quand: 'deck',
    titre: 'Liaison n\'arrive pas a calculer tes points de mix',
    texte: structSante.derniereErreur
      ? 'Derniere erreur : ' + structSante.derniereErreur
      : 'Le calcul de structure echoue sur presque tous tes morceaux.',
    marche: ['Lance « node build/diagnostic.js » et envoie la sortie',
             'C\'est presque toujours ffmpeg qui manque ou qu\'un antivirus bloque',
             'Contournement : demarre Liaison avec LIAISON_FFMPEG=/chemin/vers/ffmpeg'],
    repli: 'Les suggestions continuent de fonctionner sans les points de mix.'
  }]);
}

/* ------------------------------------------------------------
   Ce qui n'est plus a l'ecran n'a plus besoin d'etre calcule.

   Appele apres chaque construction de liste : la file du pool ne
   garde que le morceau en cours et ce qui vient d'etre propose.
   ------------------------------------------------------------ */
function oublierStructuresInutiles(ids) {
  const utiles = new Set(ids);
  if (current) utiles.add(current.id);
  try { structPool.oublier(job => utiles.has(job.cle)); } catch (e) {}
}

/* Un morceau dont la structure a ete abandonnee doit pouvoir etre
   redemande : on efface la marque plutot que de la garder pour la
   soiree. */
function reprendreStructure(track) {
  const st = structures.get(track.id);
  if (st && st.ok === false && st.abandonne) structures.delete(track.id);
}

/* Une structure qui arrive change les reperes affiches : on renvoie
   la liste, mais groupee, pour ne pas la reconstruire six fois. */
function scheduleStructRefresh() {
  if (structTimer) return;
  structTimer = setTimeout(() => {
    structTimer = null;
    if (!current) return;
    /* L'en-tete d'abord : c'est lui qui porte le ruban de structure
       et l'etiquette « Analyse de la structure… » qui doit
       disparaitre. */
    envoyerNow();
    send('suggestions', computeSuggestions(config.suggestCount));
  }, 350);
}

/* ============================================================
   LE PLAN, ET LES QUATRE ETATS QU'IL CONFONDAIT.

   planFor() rendait null dans quatre situations qui n'ont rien a
   voir : pas de morceau en cours, structure pas encore calculee,
   structure calculee et ratee, et structure impossible sur cette
   machine. Le widget, qui ne recoit qu'un null, affichait le meme
   « Points de mix en cours de calcul… » dans les quatre cas — donc
   une attente sans fin trois fois sur quatre.

   Il rend maintenant un etat. Le bandeau dit ce qui se passe, et
   quand ca ne marchera pas, il le dit au lieu de faire patienter.
   ============================================================ */
function planFor(nextTrack) {
  if (!current) return null;
  const a = structures.get(current.id), b = structures.get(nextTrack.id);
  /* Pas encore la : c'est la seule situation ou « en cours » est vrai. */
  if (!a || !b) return { ok: false, etat: 'calcul' };
  if (!a.ok || !b.ok) {
    const rate = !a.ok ? a : b;
    return { ok: false, etat: 'echec',
             note: rate.note || 'Pas de reperes lisibles sur ce morceau' };
  }
  const plan = engine.mixPlan(current, nextTrack, a, b);
  /* Un plan bati sur une structure deduite reste un plan — il porte
     seulement sa reserve avec lui. */
  if (plan && plan.ok) plan.estime = !!(a.estime || b.estime || a.partiel || b.partiel);
  return plan;
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
/* Y a-t-il quelque chose a remettre a zero ? Sans ce test, chaque
   changement de morceau renverrait un message de filtres au widget
   pour rien, toute la nuit. */
function filtresInstantActifs() {
  return !!((config.fGenres && config.fGenres.length) || config.fMarge > 0 ||
            config.fEnergyMin > 0 || config.fEnergyMax > 0);
}

function razFiltresInstant() {
  config.fGenres = [];
  config.fMarge = 0;
  config.fEnergyMin = 0;
  config.fEnergyMax = 0;
  /* Pas de saveConfig() : ces filtres ne sont volontairement jamais
     ecrits sur le disque — voir FILTRES_INSTANT et saveConfig. */
}

/* ------------------------------------------------------------
   L'etat des filtres, construit a un seul endroit.

   Le widget le demande a l'ouverture (filters:get), le recoit
   apres chaque reglage (filters:set), et le recoit encore quand
   Liaison remet les filtres d'instant a zero tout seul au morceau
   suivant. Trois chemins pour un meme objet : construit trois
   fois, il finirait par differer trois fois, et le widget
   afficherait des pastilles eteintes sur un tamis encore serre —
   c'est-a-dire le pire des deux mondes, des propositions filtrees
   sans que rien a l'ecran ne dise qu'un filtre tourne.
   ------------------------------------------------------------ */
function etatFiltres() {
  const tam = currentFilter();
  return {
    crates: crateList.map(c => ({ id: c.id, name: c.name, source: c.source, n: c.n })),
    etat: {
      /* les filtres de soiree : ils tiennent jusqu'a ce qu'on les retire */
      crate: config.fCrate, skipPlayed: !!config.fSkipPlayed,
      noExplicit: !!config.fNoExplicit,
      bpmMin: config.fBpmMin || 0, bpmMax: config.fBpmMax || 0,
      /* les filtres d'instant : poses pendant un morceau, effaces au suivant */
      genres: (config.fGenres || []).slice(),
      marge: config.fMarge || 0,
      energyMin: config.fEnergyMin || 0, energyMax: config.fEnergyMax || 0
    },
    /* combien de morceaux le tamis laisse passer, et s'il etouffe */
    restants: tam.tracks.tracks.length,
    total: library.length,
    vide: tam.tracks.vide,
    active: tam.tracks.active,
    /* le tempo joue, pour proposer une plage sensee en un clic */
    bpm: current ? current.bpm : null
  };
}

function currentFilter() {
  const crate = config.fCrate ? crateList.find(c => c.id === config.fCrate) : null;
  const f = {
    crate: crate ? { name: crate.name, ids: crate.ids } : null,
    skipPlayed: !!config.fSkipPlayed,
    playedIds: setlog ? setlog.playedIds() : new Set(),
    noExplicit: !!config.fNoExplicit,
    bpmMin: config.fBpmMin || 0, bpmMax: config.fBpmMax || 0,
    genres: config.fGenres || [],
    energyMin: config.fEnergyMin || 0, energyMax: config.fEnergyMax || 0
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
  /* ------------------------------------------------------------
     Vingt demandes suffisent a lire l'ADN de la salle.

     guests.top() rend TOUTE la file — jusqu'a deux cents entrees —
     alors que les deux autres appelants se limitent deja a vingt et
     douze. Or currentDNA() tourne a chaque changement de morceau, a
     chaque recalcul de fond (toutes les 4 s pendant l'analyse) ET a
     chaque demande d'invite.

     A 19 h, zero demande, tout est instantane. A 1 h du matin, cent
     quatre-vingts titres demandes, donc cent quatre-vingts
     rapprochements flous a chaque telephone qui valide. Le widget
     rame « a partir du milieu de la soiree » — le symptome le plus
     difficile a faire remonter par un testeur.

     Les vingt plus demandes disent deja ce que la salle veut.
     ------------------------------------------------------------ */
  for (const r of guests.top().slice(0, 20)) {
    const m = engine.match(r.artist + ' ' + r.title, library, 0.5);
    if (m) for (const tag of m.track.tags || []) guestDNA[tag] = Math.min(100, (guestDNA[tag] || 40) + r.n * 8);
  }
  let dna = locales.blendDNA(pack, guestDNA, Object.keys(guestDNA).length ? config.guestWeight : 0);
  /* Le client passe avant le pack de pays : c'est sa soiree. */
  if (Object.keys(clientSet.dna).length) dna = locales.blendDNA({ dna: dna }, clientSet.dna, 0.45);
  /* Et la fiche de soiree corrige en dernier : les genres que ce
     client-la aime montent, ceux qu'il refuse tombent. On corrige,
     on ne remplace pas — un mariage reste un mariage meme si les
     maries adorent le disco. */
  dna = lesSoirees().inflexion(dna);
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

/* ============================================================
   La bulle — l'etat, cote application.

   Elle n'est PAS dans la configuration, et c'est voulu : une bulle
   designe un morceau precis d'une bibliotheque precise. La garder
   d'une soiree a l'autre, c'est la retrouver un mois plus tard
   ancree sur un titre qu'on ne joue plus, sans savoir pourquoi les
   suggestions se sont retrecies. Elle vit le temps d'une session,
   comme la memoire des morceaux joues.
   ============================================================ */
let bulleActive = null;

/** @returns {object} l'etat, ou { impossible, raison } si on ne peut pas poser. */
function poserBulle(track) {
  if (!track) { bulleActive = null; return null; }
  /* On ancre sur le vivier REELLEMENT propose, pas sur la
     bibliotheque entiere. Un DJ dont la crate annees 80 est datee a
     100 % mais dont la bibliotheque ne l'est qu'a 20 % voyait l'axe
     des epoques desactive — sur le seul ensemble ou il aurait
     parfaitement marche. */
  let vivier = library;
  try { vivier = currentFilter().tracks.tracks; } catch (e) {}
  if (!vivier || vivier.length < 50) vivier = library;
  const b = engine.bulle.ancrer(track, vivier);
  if (!b || b.impossible) { bulleActive = null; return b || null; }
  bulleActive = b;
  return etatBulle();
}

/* ------------------------------------------------------------
   Apres un reimport, l'ancrage designe-t-il encore quelque chose ?

   Les identifiants sont deterministes — ils viennent du chemin du
   fichier — donc une bibliotheque reimportee depuis les memes
   sources rend le meme morceau. Effacer la bulle a chaque
   reimport, c'etait la faire disparaitre en pleine soiree chaque
   fois que Serato reecrit sa base. On verifie donc, et on ne
   retire que si le morceau a vraiment disparu.
   ------------------------------------------------------------ */
function revaliderBulle() {
  if (!bulleActive) return;
  const encore = library.find(t => t.id === bulleActive.id);
  if (!encore) { bulleActive = null; send('bulle', null); return; }
  /* Le morceau est toujours la, mais l'objet est neuf : on refait
     l'ancrage dessus. Garder l'ancien, c'etait garder son genre
     d'avant si le DJ vient de le retaguer, et une part d'annees
     calculee sur une bibliotheque qui n'existe plus. */
  const b = engine.bulle.ancrer(encore, library);
  if (b && !b.impossible) { bulleActive = b; send('bulle', etatBulle()); }
}

function etatBulle() {
  if (!bulleActive) return null;
  return {
    titre: bulleActive.titre, artiste: bulleActive.artiste,
    etiquette: bulleActive.etiquette, annee: bulleActive.annee,
    avecAnnees: bulleActive.avecAnnees, partAnnees: bulleActive.partAnnees,
    epoquePerdue: !!bulleActive.epoquePerdue,
    famille: bulleActive.famille
  };
}

/* ------------------------------------------------------------
   Les enchainements que CE DJ fait reellement.

   Relire tout l'historique a chaque changement de morceau serait
   absurde : il ne bouge qu'a la fin d'une soiree. On le construit
   donc une fois, et on le refait quand un set se ferme.
   ------------------------------------------------------------ */
let affinitesCache = null;
function lesAffinites() {
  if (affinitesCache) return affinitesCache;
  try { affinitesCache = engine.affinites.construire(setlog ? setlog.sets : []); }
  catch (e) { affinitesCache = null; }
  return affinitesCache;
}
function oublierAffinites() { affinitesCache = null; }

/* ============================================================
   POURQUOI IL N'Y A RIEN.

   « Si un son n'est pas reconnu, l'utilisateur doit voir pourquoi. »

   Le widget disait « Rien ne se cale — aucun titre ne s'enchaine
   sur ce tempo » dans TOUS les cas de liste vide. C'est souvent
   faux : la vraie raison est ailleurs neuf fois sur dix — un
   filtre de crate oublie, un morceau en cours sans tempo, un
   disque debranche, une bibliotheque pas encore analysee. Le DJ
   cherchait une panne de tempo qui n'existait pas.

   On passe donc la chaine en revue dans l'ordre, et on nomme la
   PREMIERE porte qui se ferme, avec la marche a suivre. C'est la
   meme logique que build/pourquoi.js, ramenee en cabine.

   @returns {object|null} un conseil, ou null si tout va bien.
   ============================================================ */
function raisonDuVide(cur, vivier, tam) {
  const total = library.length;
  if (!total) return null;                 /* deja traite par le widget */

  if (!cur) return null;

  /* 1. le morceau en cours n'a pas de tempo ET rien d'autre non plus */
  const avecTempo = vivier.filter(t => t.bpm > 0).length;
  if (!(cur.bpm > 0) && !avecTempo) {
    return { cle: 'vide-sans-tempo', quand: 'vide',
      titre: 'Aucun tempo nulle part',
      texte: 'Ni le morceau en cours ni ta bibliotheque n\'ont de tempo enregistre. ' +
             'Liaison le mesure lui-meme, mais il lui faut le temps d\'ecouter chaque titre.',
      marche: ['Laisse l\'analyse tourner quelques minutes',
               'Ou fais analyser ta collection dans ton logiciel de mix'] };
  }

  /* 2. les filtres */
  const sansFiltre = library.length;
  if (vivier.length < sansFiltre * 0.25) {
    const quoi = [];
    if (config.fCrate) quoi.push('un crate');
    if (config.fBpmMin || config.fBpmMax) quoi.push('une fourchette de tempo');
    if (config.fNoExplicit) quoi.push('le filtre paroles');
    return { cle: 'vide-filtres', quand: 'vide',
      titre: 'Tes filtres ne laissent presque rien',
      texte: vivier.length + ' morceaux sur ' + sansFiltre + ' passent tes filtres' +
             (quoi.length ? ' (' + quoi.join(', ') + ')' : '') + '.',
      marche: ['Ouvre FILTRES en bas du widget et desserre',
               'Le crate est le filtre qui coupe le plus souvent'] };
  }

  /* 3. le disque */
  const absents = vivier.filter(t => t.offline).length;
  if (absents > vivier.length * 0.5) {
    return { cle: 'vide-disque', quand: 'vide',
      titre: 'Le disque n\'est pas la',
      texte: absents + ' morceaux sur ' + vivier.length + ' pointent un fichier introuvable.',
      marche: ['Rebranche le disque externe',
               'Ou reexporte ta collection depuis ton logiciel'] };
  }

  /* 4. tout a deja ete joue ce soir */
  const joues = setlog && setlog.current ? setlog.current.played.length : 0;
  if (joues && joues >= vivier.length - 1) {
    return { cle: 'vide-tout-joue', quand: 'vide',
      titre: 'Tu as joue presque toute la selection',
      texte: joues + ' titres joues sur ' + vivier.length + ' disponibles.',
      marche: ['Desserre le crate pour ouvrir la selection',
               'Le bouton SOS, lui, a le droit de rejouer'] };
  }

  /* 5. le vrai cas du tempo : on dit lequel etait le plus proche */
  if (cur.bpm > 0) {
    let proche = null, ecart = Infinity;
    for (const t of vivier) {
      if (!(t.bpm > 0) || t.id === cur.id) continue;
      const d = Math.abs(t.bpm - cur.bpm) / cur.bpm;
      if (d < ecart) { ecart = d; proche = t; }
    }
    if (proche) {
      return { cle: 'vide-tempo', quand: 'vide',
        titre: 'Rien ne se cale sur ' + Math.round(cur.bpm) + ' BPM',
        texte: 'Le plus proche est « ' + proche.title + ' » a ' + Math.round(proche.bpm) +
               ' BPM, soit ' + Math.round(ecart * 100) + ' % d\'ecart.',
        marche: ['Passe par un morceau relais',
                 'Ou desserre la fourchette de tempo dans FILTRES'] };
    }
  }
  return null;
}

function computeSuggestions(limit) {
  if (!current) return [];

  /* ------------------------------------------------------------
     NE PAS PROPOSER N'IMPORTE QUOI PENDANT DEUX SECONDES.

     « Regarde les propositions de merde avec Daddy Cool ! »

     Capture a l'appui : « BPM 0.0, ENERGIE 5 ». Le morceau n'avait
     ni tag de tempo ni analyse terminee. Sans tempo, l'axe le plus
     lourd du moteur se tait — d'ou les « ±0,0 % » sur chaque ligne
     — et le classement se fait sur ce qui reste. Le resultat n'est
     pas une mauvaise suggestion : c'est un tirage.

     Or ce morceau est prioritaire dans la file : il sera mesure
     dans les secondes qui suivent. Proposer un tirage en attendant
     ne rend service a personne et abime la confiance pour toute la
     soiree. On attend, on le DIT, et la liste arrive d'elle-meme
     des que la mesure tombe — envoyerNow() et scheduleResuggest()
     s'en chargent.

     On n'attend que si la mesure va reellement venir : sans fil
     d'analyse, ou sur un fichier injoignable, on preferera
     toujours une liste imparfaite a un ecran vide.
     ------------------------------------------------------------ */
  if (!(current.bpm > 0) && !current.analyzed &&
      analyse && analyse.enAttente(current.id)) {
    send('conseils', [{
      cle: 'vide', quand: 'vide',
      titre: 'Liaison mesure ce morceau',
      texte: 'Il n\'a pas de tempo enregistre. Liaison l\'ecoute pour le trouver lui-meme — ' +
             'quelques secondes, et les propositions arrivent.',
      marche: ['Rien a faire, ca se met a jour tout seul'],
      repli: 'Sans tempo, les propositions seraient tirees au hasard : mieux vaut attendre.'
    }]);
    return [];
  }
  const f = feat();
  /* Le nombre de suggestions est celui que la licence ouvre — 3 en
     essai, 5 en Resident, 7 en Collectif. Il etait plafonne a 3 pour
     tout le monde parce que tous les appels passaient limit = 3 et que
     config.suggestCount n'existait nulle part : la fenetre de reglages
     affichait « Ouvert : 5 suggestions » a un client qui en recevait
     trois. A 19 euros par mois, c'est la fonction vendue qui n'etait
     pas livree. */
  const voulu = limit || config.suggestCount || f.suggestions;
  const n = Math.max(1, Math.min(voulu, f.suggestions));
  const mode = (config.mode === 'trend' && !f.trends) ? 'crowd' : config.mode;

  const tam = currentFilter();
  let vivier = tam.tracks.tracks;
  if (tam.reserve) vivier = vivier.filter(t => t.id !== tam.reserve);

  /* Pendant l'atterrissage, c'est le plan qui commande la courbe :
     le DJ a annonce une heure de fin, elle prime sur le pack. */
  const ph = landingNow();
  /* ------------------------------------------------------------
     En bulle, la courbe tient.

     C'est la moitie de la demande : « l'app cherche a augmenter le
     rythme ». La montee d'energie est ce qui fait sortir du style
     — un cran plus haut a chaque titre, et au bout de six on n'est
     plus dans la meme soiree. Une soiree a theme se joue sur un
     plateau. L'atterrissage de fin de set garde la priorite : quand
     il faut redescendre, il faut redescendre.
     ------------------------------------------------------------ */
  const arc = ph ? ph.arc
                 : bulleActive ? 'hold'
                 : (config.arc === 'auto' ? (arcAuto() || 'hold') : config.arc);

  /* Ce que Liaison a appris de ce DJ. Neutre les douze premiers
     enchainements, puis de plus en plus present. */
  const g = leGout().reglages();

  const bruts = engine.suggest(current, vivier, {
    dna: currentDNA(), arc: arc, mode: mode, bulle: bulleActive,
    affinites: lesAffinites(),
    poids: g.poids, marge: g.marge, variete: g.variete, pas: g.pas,
    banned: bannedSet(), wanted: clientSet.wanted,
    trends: trends, limit: n,
    /* la memoire de la soiree : ce qui vient d'etre joue */
    recent: setlog && setlog.current ? setlog.current.played : [],
    avancement: ph && landPlan ? 1 : 0,
    /* quand l'heure de la cloture est venue, on la fait remonter —
       apres avoir verifie qu'elle est encore mixable depuis ce qui
       tourne, et en la remplacant si elle ne l'est plus */
    epingle: clotureEpinglee(vivier, ph),
    repertoire: repCentre ? { centre: repCentre, ouvertes: repOuvertes } : null,
    /* La marge demandee a la main passe devant celle qu'on a apprise :
       quand le DJ dit « a deux pour cent », il ne demande pas un avis. */
    marge: config.fMarge > 0 ? config.fMarge / 100 : g.marge
  });

  /* On garde les propositions BRUTES : ce sont elles qui portent
     les notes par critere, et donc l'etiquette dont l'apprentissage
     a besoin au prochain changement de morceau. */
  dernieresPropositions = bruts;

  /* Liste vide : on dit pourquoi, tout de suite, au lieu de laisser
     le widget servir sa phrase generique sur le tempo. */
  if (!bruts.length) {
    try {
      const avis = raisonDuVide(current, vivier, tam);
      if (avis) send('conseils', [avis]);
    } catch (e) { /* expliquer ne doit jamais empecher de jouer */ }
  }

  oublierStructuresInutiles(bruts.map(r => r.track.id));
  return bruts.map(r => {
    reprendreStructure(r.track);
    ensureStructure(r.track, 1);
    const plan = planFor(r.track);
    const st = structures.get(r.track.id);
    return {
      title: r.track.title, artist: r.track.artist, key: r.track.key, bpm: r.track.bpm,
      energy: r.track.energy, id: r.track.id, path: r.track.path,
      total: r.total, transition: r.transition.n, why: r.transition.d,
      /* ------------------------------------------------------------
         Le BPM, la cle, et d'ou ils viennent.

         Le widget recevait deja bpm et key ; il ne recevait pas de
         quoi dire au DJ s'il lisait un beatgrid rekordbox ou une
         estimation de Liaison. Sur la ligne la plus lue de la
         cabine, c'est une difference qui compte : un tempo mesure
         et sur se cale, un tempo estime se verifie au casque.
         ------------------------------------------------------------ */
      bpmSource: r.track.bpmSource || null,
      keySource: r.track.keySource || null,
      bpmSur: r.track.bpmSource !== 'liaison-incertain',
      keySure: r.track.keySource !== 'liaison-incertain',
      /* Entre par la porte elargie : le tempo ne se cale pas, il se coupe. */
      horsFenetre: !!r.horsFenetre, fenetre: r.fenetre || null,
      /* Hors de son repertoire : on le propose quand meme, mais on dit
         pourquoi il est la — sinon le DJ croit a une erreur. */
      horsRepertoire: r.repertoireDit || null,
      /* Sans tempo sur le morceau en cours, cette division rendait NaN
         et le widget affichait « -NaN % » sur les cinq lignes : la
         correction du « rien ne se cale » redonnait des propositions
         que le DJ jugeait cassees. null se tait proprement. */
      delta: current.bpm > 0 ? Math.round((r.tempo.delta / current.bpm) * 1000) / 10 : null,
      trend: r.trend, h: Math.round(r.h), tempoS: Math.round(r.tempo.s),
      crowd: r.crowd, timbre: Math.round(r.timbreScore),
      plan: plan, introBars: st && st.ok ? st.introBars : null, client: !!r.client,
      cloture: !!r.cloture,
      /* « hors bulle » n'est pas une erreur : c'est ce que Liaison a
         trouve de mieux quand la bulle ne remplit pas la liste. On le
         dit plutot que de le cacher — ou de ne rien proposer. */
      bulle: r.bulle, horsBulle: bulleActive ? !r.dansBulle : false,
      /* de quoi dire au DJ POURQUOI, plutot que de lui donner un chiffre */
      pourquoi: r.pourquoi || null, age: r.age || null,
      /* Le plancher : « ce morceau relance la piste ». On ne remonte
         que le sens positif — ceux qui la cassent ne sont plus
         proposes du tout, dire « casse la piste » sur une ligne qu'on
         affiche quand meme serait un aveu, pas une aide. */
      relance: r.plancherDit === 'relance',
      /* « tu l'as deja passe » : ce soir, ou une autre fois au meme endroit */
      deja: setlog ? setlog.lastPlay(r.track.id, { sameName: config.sessionName }) : null
    };
  });
}

/* ============================================================
   LES MORCEAUX HORS BIBLIOTHEQUE.

   « J'ai des sons qui, quand je les passe, ne sont pas du tout
     reconnus : rien ne s'affiche alors qu'ils tournent. »

   Voir l'en-tete de src/exterieur.js pour les trois endroits qui
   jetaient en silence. Ici, on les rattrape : le morceau est
   fabrique a partir de ce qu'on a — un chemin de fichier dans le
   meilleur des cas, un texte sinon —, il est mis devant dans la
   file d'analyse, et il devient le morceau en cours comme
   n'importe quel autre.

   On les garde dans un registre, pour trois raisons : garder le
   meme identifiant si le meme morceau revient, pouvoir les
   reinscrire dans l'analyse apres une resynchronisation de
   bibliotheque — charger() vide tout —, et ne pas refaire un
   ffprobe a chaque passage.
   ============================================================ */
const horsBiblio = new Map();          /* cle -> morceau */
let dernierHors = null;

function idsPris() {
  const s = new Set();
  for (const t of library) s.add(t.id);
  for (const t of horsBiblio.values()) s.add(t.id);
  return s;
}

/** Reinscrit les morceaux hors bibliotheque apres un charger(). */
function reinscrireHors() {
  if (!analyse) return;
  for (const t of horsBiblio.values()) {
    if (t.path) { try { analyse.ajouter(t, t === current ? 2 : 1); } catch (e) {} }
  }
}

/* Ce que le widget doit lire quand le morceau n'est pas dans la
   bibliotheque : ce n'est ni une panne ni un vide, et la marche a
   suivre depend de ce qu'on a pu recuperer. */
function conseilHors(t) {
  if (t && t.path) {
    return { cle: 'hors-biblio-fichier', quand: 'deck',
      titre: 'Ce morceau n\'est pas dans ta bibliotheque',
      texte: 'Liaison l\'a bien detecte sur le deck et il analyse le fichier en ce moment : ' +
             'tempo, tonalite et energie vont arriver, et les propositions avec. ' +
             'Il ne pourra simplement jamais etre PROPOSE tant qu\'il n\'est pas importe.',
      marche: ['Reglages > Bibliotheque > Resynchroniser pour l\'ajouter pour de bon',
               'S\'il vit sur une cle USB, ajoute le dossier de la cle'],
      repli: 'En attendant, les propositions se calculent quand meme a partir de lui.' };
  }
  return { cle: 'hors-biblio-texte', quand: 'deck',
    titre: 'Morceau detecte, mais introuvable dans ta bibliotheque',
    texte: 'Ton logiciel annonce un titre que Liaison n\'a pas su rapprocher d\'un morceau ' +
           'connu, et il n\'annonce pas le chemin du fichier : impossible de l\'analyser. ' +
           'Sans tempo ni tonalite, les propositions restent approximatives.',
    marche: ['Verifie que le dossier de ce morceau est bien importe',
             'Reglages > Bibliotheque > Resynchroniser',
             'Ou clique la loupe et declare le morceau a la main'],
    repli: 'Liaison continue de proposer sur ce qu\'il sait : genre, notoriete, moment de la soiree.' };
}

/**
 * Un fichier tourne, il n'est pas dans la bibliotheque : on le prend
 * quand meme. @returns {Promise<object|null>}
 */
async function adopterFichier(chemin, how) {
  const cle = libmod.cleChemin(chemin);
  let t = horsBiblio.get(cle);
  if (!t) {
    t = await exterieur.depuisFichier(chemin, idsPris());
    if (!t) return null;
    horsBiblio.set(cle, t);
  }
  /* La bibliotheque a pu s'enrichir depuis : si le morceau y est
     entre, c'est elle qui gagne et le doublon disparait. */
  const vrai = chemins().get(cle);
  if (vrai) { horsBiblio.delete(cle); return vrai; }
  if (analyse) { try { analyse.ajouter(t, 2); } catch (e) {} }
  if (!current || current.id !== t.id) {
    setCurrent(t, how || 'rekordbox');
    if (dernierHors !== t.id) { dernierHors = t.id; send('conseils', [conseilHors(t)]); }
  }
  return t;
}

/** Un texte tourne et ne se rapproche de rien : on l'affiche quand meme. */
function adopterTexte(texte, how) {
  const t = exterieur.depuisTexte(texte, idsPris());
  if (!t) return null;
  const cle = 'texte:' + String(texte).toLowerCase();
  const deja = horsBiblio.get(cle);
  if (deja) { if (!current || current.id !== deja.id) setCurrent(deja, how || 'detect'); return deja; }
  horsBiblio.set(cle, t);
  if (analyse) { try { analyse.ajouter(t, 2); } catch (e) {} }
  setCurrent(t, how || 'detect');
  if (dernierHors !== t.id) { dernierHors = t.id; send('conseils', [conseilHors(t)]); }
  return t;
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
        arc: config.arc === 'auto' ? (arcAuto() || 'hold') : config.arc,
        bulle: !!bulleActive,
        affinites: lesAffinites()
      });
    }
  } catch (e) { /* apprendre ne doit jamais empecher de jouer */ }

  /* ------------------------------------------------------------
     LES FILTRES D'INSTANT RETOMBENT ICI.

     « Une fois que le son est joue, les filtres retournent par
       defaut. »

     C'est exactement le bon endroit : un filtre d'instant repond a
     la question « qu'est-ce que je passe MAINTENANT ». Des que ce
     maintenant est passe sur un deck, la question est resolue et le
     filtre n'a plus de raison d'exister.

     On ne touche PAS aux filtres de soiree — le crate, « sans
     paroles explicites », « pas ce qui est deja passe ». Ceux-la, le
     DJ les a poses en arrivant, et les effacer tout seuls le ferait
     jouer un titre explicite devant la famille sans qu'il ait rien
     demande.

     Et on ne les efface pas quand c'est LUI qui declare le morceau a
     la loupe : dans ce cas il est en train de chercher, pas de
     jouer — lui retirer son filtre au milieu de sa recherche serait
     absurde.
     ------------------------------------------------------------ */
  if (how !== 'manuel' && filtresInstantActifs()) {
    razFiltresInstant();
    send('filters', etatFiltres());
  }

  current = track;
  /* Il vient d'en jouer un : cette ecriture et cette famille cessent
     d'etre etrangeres a son repertoire pour le reste de la soiree. */
  try { repertoire.ouvrir(track, repOuvertes); } catch (e) {}
  commentIl = how || 'auto';
  /* Priorite 2 : sans SA structure, aucun plan n'existe, quelle que
     soit la qualite de celles des suggestions. */
  reprendreStructure(track);
  ensureStructure(track, 2);
  prioriserAnalyse();
  if (setlog) setlog.play(track, how || null);
  envoyerNow();
  send('suggestions', computeSuggestions(config.suggestCount));
}

/* ------------------------------------------------------------
   L'EN-TETE, RENVOYE QUAND CE QU'IL DIT CHANGE.

   « Pourquoi il dit Daddy Cool 0 BPM ? Pourquoi ANALYSE DE LA
   STRUCTURE reste affiche tout le temps ? »

   Les deux avaient la meme cause. L'en-tete — titre, tonalite,
   tempo, energie, ruban de structure — n'etait envoye QU'UNE
   FOIS, au moment ou le morceau est detecte. A cet instant precis,
   rien n'est encore mesure : le tempo vaut zero, l'energie vaut 5
   par defaut, la structure n'existe pas.

   Deux secondes plus tard l'analyse a fini et l'objet en memoire
   porte les vraies valeurs — le moteur les utilise — mais le
   widget, lui, n'a jamais ete prevenu. Il affichait donc « BPM
   0.0 » et « Analyse de la structure… » pour toujours, sur un
   morceau parfaitement analyse.

   On renvoie donc l'en-tete des que quelque chose qu'il montre a
   change : fin de l'analyse du morceau en cours, ou arrivee de sa
   structure.
   ------------------------------------------------------------ */
let commentIl = 'auto';
function envoyerNow() {
  send('now', current ? {
    id: current.id, title: current.title, artist: current.artist, key: current.key,
    bpm: current.bpm, energy: current.energy, how: commentIl,
    /* ce qu'on sait encore : le DJ doit pouvoir distinguer « pas
       encore mesure » de « mesure, et c'est ca » */
    mesure: !!current.analyzed,
    horsBiblio: !!current.horsBiblio, sansFichier: !!current.sansFichier,
    tempoDeduit: !!current.bpmDeduit, tempoCorrige: !!current.bpmCorrige,
    tonaliteDeduite: !!current.keyDeduite, tonaliteCorrigee: !!current.keyCorrigee,
    structure: structures.get(current.id) || null
  } : null);
}

/* ---------------- source now-playing ---------------- */
now.on('text', text => {
  const m = engine.match(text, library);
  if (m) {
    if (!current || m.track.id !== current.id) setCurrent(m.track, 'detect');
    send('raw', { text: text, matched: m.track.title });
    return;
  }
  /* ------------------------------------------------------------
     Inconnu. Avant, la fonction s'arretait ici : le widget gardait
     le morceau PRECEDENT a l'ecran pendant que le DJ en jouait un
     autre — pire que rien, puisque les propositions portaient
     alors sur un morceau fini depuis longtemps.

     On affiche donc ce qui tourne vraiment, meme maigre, et on dit
     pourquoi c'est maigre.
     ------------------------------------------------------------ */
  const t = adopterTexte(text, 'detect');
  send('raw', { text: text, matched: null, horsBiblio: !!t });
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
  for (const t of library) {
    if (t.path) indexChemins.set(libmod.cleChemin(t.path), t);
    /* Les copies repliees par le dedoublonnage repondent aussi :
       le DJ a le morceau sur deux disques, Serato charge celui que
       nous n'avons pas garde, et sans ces alias le titre sortirait
       « hors bibliotheque ». Voir dedoublonner() dans library.js. */
    if (t.alias) for (const a of t.alias) {
      const cle = libmod.cleChemin(a);
      if (!indexChemins.has(cle)) indexChemins.set(cle, t);
    }
  }
  return indexChemins;
}

/* ============================================================
   Qui a le droit d'ouvrir le reseau Pro DJ Link.

   Reponse : pas nous, des que rekordbox tourne. Un DJ avec deux
   CDJ-2000 en RJ45 a vu son bouton LINK mourir parce que Liaison
   tenait le port UDP 50002 — voir l'en-tete de sources/prolink.js.
   Liaison ecoute ; rekordbox pilote les platines. En cas de
   conflit, c'est toujours l'instrument qui gagne.

   On lit la liste des applications reellement en cours, pas un
   reglage : le DJ n'a rien a configurer, et le cas se resout tout
   seul dans les deux sens.
   ============================================================ */
function reseauDeckLibre() {
  try {
    for (const a of watcher.current()) {
      if (a && a.id === 'rekordbox') return false;
    }
  } catch (e) { /* dans le doute, on cede */ return false; }
  return true;
}

function startRekordboxFichiers() {
  stopRekordboxFichiers();
  /* On demarre AUSSI sous Windows, ou le module se contente
     d'expliquer pourquoi il ne peut rien lire. On sortait ici sans
     rien dire : le DJ Windows n'avait donc ni detection ni
     explication — juste un widget muet. */
  rbWatch = rbFichiers.start({
    /* ------------------------------------------------------------
       Un chemin que la bibliotheque ne connait pas n'est plus un
       chemin perdu.

       Cette fonction rendait null, et null ne declenchait rien. Or
       c'est le cas le PLUS facile de tous : on a le fichier lui-meme,
       sous les yeux, avec ses tags et de quoi l'analyser. On le
       fabrique donc a la volee — voir adopterFichier().
       ------------------------------------------------------------ */
    resoudre: p => {
      const t = chemins().get(libmod.cleChemin(p));
      if (t) return t;
      const cle = libmod.cleChemin(p);
      const deja = horsBiblio.get(cle);
      if (deja) return deja;
      /* Pas encore lu : on lance la lecture des tags, et le morceau
         sera la au prochain passage de la sonde, une seconde plus
         tard. On ne fait jamais attendre la boucle de detection. */
      if (Date.now() - dernierPaquetDeck >= 60000) {
        adopterFichier(p, 'rekordbox').catch(() => {});
      }
      return null;
    }
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
let dernierIdInconnu = null;
now.on('deck', st => {
  dernierPaquetDeck = Date.now();
  const t = library.find(x => x.rbId && x.rbId === st.trackId);
  if (t) {
    if (!current || t.id !== current.id) setCurrent(t, 'deck ' + st.device);
    return;
  }
  send('raw', { text: 'Deck ' + st.device + ' - identifiant rekordbox ' + st.trackId, matched: null });
  /* ------------------------------------------------------------
     Pro DJ Link n'annonce JAMAIS le titre : il annonce un numero de
     morceau dans la base rekordbox. Le titre se retrouve en croisant
     ce numero avec un export rekordbox.xml.

     Sans cet export, aucun morceau de la bibliotheque ne porte de
     rbId : le croisement echoue sur TOUS les morceaux, a chaque
     fois, et Liaison se taisait. Un DJ en cabine avec du vrai
     materiel — donc le cas le plus professionnel de tous — voyait
     un widget mort sans la moindre explication.
     ------------------------------------------------------------ */
  const avecId = library.filter(x => x.rbId).length;
  const cle = avecId ? 'deck-id-inconnu' : 'deck-sans-xml';
  if (dernierIdInconnu === cle) return;
  dernierIdInconnu = cle;
  send('conseils', [avecId
    ? { cle: cle, quand: 'deck',
        titre: 'Ce morceau n\'est pas dans l\'export rekordbox importe',
        texte: 'Le materiel annonce bien le morceau charge, mais son numero n\'existe pas ' +
               'dans le rekordbox.xml que Liaison a lu. L\'export date d\'avant l\'ajout ' +
               'de ce morceau.',
        marche: ['Dans rekordbox : Fichier > Exporter la collection au format xml',
                 'Reglages > Bibliotheque > choisir ce fichier'],
        repli: 'Les morceaux deja presents dans l\'export continuent d\'etre reconnus.' }
    : { cle: cle, quand: 'deck',
        titre: 'Il manque l\'export rekordbox pour nommer les morceaux',
        texte: 'Le materiel Pioneer annonce un numero de morceau, jamais son titre. ' +
               'Sans export rekordbox.xml, Liaison recoit bien le signal mais ne peut ' +
               'le relier a aucun morceau : c\'est pour ca que rien ne s\'affiche.',
        marche: ['Dans rekordbox : Fichier > Exporter la collection au format xml',
                 'Reglages > Bibliotheque > choisir ce fichier',
                 'Le widget se remplit des le morceau suivant'],
        repli: 'Sans materiel, Liaison sait aussi lire les fichiers que rekordbox ouvre.' }]);
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

/* Les reglages qui ne changent que l'apparence. Ils passaient par
   le meme chemin que les autres, donc chaque bascule de theme —
   et desormais chaque changement de hauteur — relancait un calcul
   complet de suggestions sur toute la bibliotheque. Sur 22 000
   titres, ca se sent au doigt. */
const DECOR = ['theme', 'densite', 'opacity'];

ipcMain.handle('config:set', (e, patch) => {
  const p = patch || {};
  Object.assign(config, p); saveConfig();
  if (p.source) now.start(config.source, config.sourceOpts);
  const clefs = Object.keys(p);
  if (!clefs.length || !clefs.every(k => DECOR.includes(k)))
    send('suggestions', computeSuggestions(config.suggestCount));
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

/* ============================================================
   LES DOSSIERS AJOUTES A LA MAIN — trois gestes, rien de plus.

   « library:pick » existait deja et remplacait toute la
   bibliotheque par le dossier choisi. On le laisse pour le cas ou
   le DJ veut pointer SON export rekordbox, et on ajoute ici la
   liste de dossiers, qui, elle, s'additionne.
   ============================================================ */
/* ============================================================
   LE RAPPORT DE DIAGNOSTIC.

   Un DJ a ecrit « il ne trouve rien, et meme avec un titre charge
   il affiche toujours l'ancien ». Tout y etait sauf ce qu'il
   fallait : QUELLE source a ete lue, COMBIEN elle a rendu, et a
   quoi ressemblent ses chemins. Sans ca, on devine — et on a
   devine deux fois de suite.

   Ce rapport tient en un texte que le DJ copie et colle. Il n'est
   jamais envoye tout seul : il contient des chemins de fichiers et
   des titres, donc c'est SA decision, pas la notre.
   ============================================================ */
function rapportDiagnostic() {
  const L = [];
  const n = x => (x || 0).toLocaleString('fr-FR');
  L.push('--- DIAGNOSTIC LIAISON ---');
  L.push('version ' + app.getVersion() + '  ·  ' + process.platform + ' ' + process.arch +
         '  ·  electron ' + process.versions.electron);
  L.push('');

  L.push('BIBLIOTHEQUE : ' + n(library.length) + ' titre(s)');
  if (dernierImport) {
    const age = Math.round((Date.now() - dernierImport.quand) / 1000);
    L.push('dernier import il y a ' + age + ' s');
    for (const s of dernierImport.sources) {
      L.push('  · ' + s.kind + (s.manuel ? ' (ajoute a la main)' : '') + ' — ' + s.lus + ' lu(s)');
      L.push('      ' + s.path);
      if (s.erreur) L.push('      ERREUR : ' + s.erreur);
      for (const e of s.exemples)
        L.push('      ' + (e.existe ? 'fichier OK  ' : 'INTROUVABLE ') + e.path);
      if (s.lus && !s.exemples.some(e => e.existe))
        L.push('      >>> la base est lue mais AUCUN de ses fichiers ne repond');
    }
    L.push('  doublons replies : ' + n(dernierImport.doublons));
    L.push('  retires (fichier introuvable) : ' + n(dernierImport.retires));
    L.push('  hors ligne (disque absent) : ' + n(dernierImport.horsLigne));
  } else {
    L.push('  aucun import enregistre dans cette session');
  }
  L.push('');

  L.push('DOSSIERS AJOUTES : ' + ((config.dossiers || []).length || 'aucun'));
  for (const d of dossiersmod.sources(config.dossiers))
    L.push('  · ' + (d.present ? 'present ' : 'ABSENT  ') + d.path);
  L.push('');

  /* --------------------------------------------------------
     LE MORCEAU EN COURS, ET POURQUOI IL N'EST PAS RAPPROCHE.

     C'est la moitie la plus utile : on montre ce que le logiciel
     a annonce, la cle que ca produit, et si la bibliotheque
     contient cette cle. Un ecart d'un caractere se voit alors.
     -------------------------------------------------------- */
  L.push('SUR LE DECK');
  if (!current) L.push('  rien en cours');
  else {
    L.push('  ' + (current.artist || '?') + ' — ' + (current.title || '?'));
    L.push('  hors bibliotheque : ' + (current.horsBiblio ? 'OUI' : 'non') +
           '   source : ' + (commentIl || '?'));
    if (current.path) {
      const cle = libmod.cleChemin(current.path);
      L.push('  chemin annonce : ' + current.path);
      L.push('  cle calculee   : ' + cle);
      L.push('  dans l\'index  : ' + (chemins().has(cle) ? 'OUI' : 'NON'));
      if (!chemins().has(cle)) {
        /* On cherche le plus proche : si un seul caractere separe
           les deux, il faut le VOIR. */
        const base = String(current.path).split(/[\\/]/).pop().toLowerCase();
        const proches = [];
        for (const k of chemins().keys()) {
          if (k.endsWith(base)) { proches.push(k); if (proches.length >= 3) break; }
        }
        for (const pr of proches) L.push('  cle proche     : ' + pr);
        if (!proches.length) L.push('  aucun morceau de la bibliotheque ne porte ce nom de fichier');
      }
    } else {
      L.push('  le logiciel n\'annonce pas de chemin de fichier (titre seul)');
    }
  }
  L.push('');
  L.push('LOGICIELS OUVERTS : ' +
    ((() => { try { return watcher.current().map(a => a.id).join(', ') || 'aucun'; }
              catch (e) { return 'inconnu'; } })()));
  L.push('--- fin ---');
  return L.join('\n');
}

ipcMain.handle('diag:rapport', () => rapportDiagnostic());

ipcMain.handle('dossiers:liste', () => ({
  liste: dossiersmod.sources(config.dossiers),
  /* combien de morceaux viennent de chacun : le DJ doit voir si
     son ajout a servi a quelque chose */
  comptes: (() => {
    const c = {};
    for (const t of library) {
      if (!t.path) continue;
      for (const d of (config.dossiers || [])) {
        if (dossiersmod.contient(d, t.path)) { c[d] = (c[d] || 0) + 1; break; }
      }
    }
    return c;
  })()
}));

ipcMain.handle('dossiers:ajouter', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Choisis un dossier de musique',
    message: 'Liaison lira ce dossier EN PLUS de ce qu\'il a deja trouve.',
    properties: ['openDirectory', 'multiSelections', 'createDirectory']
  });
  if (r.canceled || !r.filePaths.length) return { annule: true };

  let liste = (config.dossiers || []).slice();
  const refuses = [];
  let bouge = false;
  for (const p of r.filePaths) {
    const a = dossiersmod.ajouter(liste, p);
    liste = a.liste;
    if (a.ajoute) bouge = true; else refuses.push({ path: p, raison: a.raison });
  }
  if (!bouge) return { annule: false, ajoute: 0, refuses: refuses };

  config.dossiers = liste; saveConfig();
  /* On relit tout : la fusion et les doublons se jouent sur
     l'ensemble des sources, pas sur le dernier dossier. */
  await autoImport(config.source);
  return { annule: false, ajoute: r.filePaths.length - refuses.length,
           refuses: refuses, n: library.length };
});

ipcMain.handle('dossiers:retirer', async (e, p) => {
  const r = dossiersmod.retirer(config.dossiers, p);
  if (!r.retire) return { retire: false };
  config.dossiers = r.liste; saveConfig();
  await autoImport(config.source);
  return { retire: true, n: library.length };
});

ipcMain.handle('source:pickFile', async () => {
  const r = await dialog.showOpenDialog({ title: 'Fichier now-playing', properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('suggest', () => computeSuggestions(config.suggestCount));

/* ---------------- la bulle ----------------
   Un seul bouton, trois gestes : poser, recentrer, sortir. */
ipcMain.handle('bulle:get', () => etatBulle());
ipcMain.handle('bulle:basculer', () => {
  if (bulleActive) { poserBulle(null); send('bulle', null); }
  else {
    /* Sans morceau en cours il n'y a rien a quoi s'accrocher. On le
       dit — la premiere version repondait « bulle levee » a
       quelqu'un qui essayait d'en poser une. */
    if (!current) return { impossible: true, raison: 'Aucun morceau en cours : lance un titre d\'abord.' };
    const r = poserBulle(current);
    if (r && r.impossible) return r;
    send('bulle', r);
  }
  send('suggestions', computeSuggestions(config.suggestCount));
  return etatBulle();
});
/* Recentrer : la soiree change de theme sans sortir du mode. Le DJ
   passe du bloc annees 80 au bloc annees 2000, il reancre.
   Sans morceau en cours, on ne touche a RIEN : la premiere version
   detruisait silencieusement la bulle si le logiciel de mix venait
   de se fermer. */
ipcMain.handle('bulle:recentrer', () => {
  if (!current) return { impossible: true, raison: 'Aucun morceau en cours : la bulle est inchangee.' };
  const avant = bulleActive;
  const r = poserBulle(current);
  if (r && r.impossible) { bulleActive = avant; return r; }
  send('bulle', r);
  send('suggestions', computeSuggestions(config.suggestCount));
  return etatBulle();
});
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
  if (current) send('suggestions', computeSuggestions(config.suggestCount));
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
  if (current) send('suggestions', computeSuggestions(config.suggestCount));
  send('client', { stats: clientSet.stats });
  return { ok: true, stats: clientSet.stats };
});

ipcMain.handle('client:remove', (e, opt) => {
  const side = opt.side === 'banned' ? 'clientBanned' : 'clientWanted';
  config[side] = (config[side] || []).filter(x =>
    ((x.artist || '') + '|' + x.title).toLowerCase() !== String(opt.key).toLowerCase());
  saveConfig();
  rebuildClient();
  if (current) send('suggestions', computeSuggestions(config.suggestCount));
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

/* ------------------------------------------------------------
   Les soirees preparees.

   Une fiche par soiree : contexte, listes du client, genres aimes
   et evites, duree. On l'active en arrivant sur place et tout
   bascule d'un coup — y compris le QR des invites, qui est
   derive de l'identifiant de la fiche.
   ------------------------------------------------------------ */
ipcMain.handle('soirees:liste', () => ({
  liste: lesSoirees().liste(),
  active: lesSoirees().active(),
  pays: locales.COUNTRIES, evenements: locales.EVENTS
}));
ipcMain.handle('soirees:creer', (e, patch) => lesSoirees().creer(patch || {}));
ipcMain.handle('soirees:modifier', (e, o) => lesSoirees().modifier(o && o.id, (o && o.patch) || {}));
ipcMain.handle('soirees:dupliquer', (e, o) => lesSoirees().dupliquer(o && o.id, o && o.nom));
ipcMain.handle('soirees:supprimer', (e, id) => ({ ok: lesSoirees().supprimer(id) }));

/* Activer une fiche : on applique ses reglages a la configuration
   en cours, on reconstruit les listes du client, et on relance une
   suggestion. Le DJ n'a rien d'autre a toucher. */
ipcMain.handle('soirees:activer', (e, id) => {
  const s = lesSoirees().activer(id);
  if (!s) return { ok: false };
  const r = lesSoirees().reglages(id);
  config.sessionName = r.sessionName;
  config.pack = r.pack;
  config.clientWanted = r.clientWanted;
  config.clientBanned = r.clientBanned;
  /* Le QR des invites suit la fiche : chaque soiree a son jeton, donc
     son lien. Un QR affiche la semaine derniere n'ouvre plus rien. */
  config.sessionToken = r.sessionToken;
  saveConfig();
  rebuildClient();
  if (current) send('suggestions', computeSuggestions(config.suggestCount));
  send('client', { stats: clientSet.stats });
  return { ok: true, soiree: s, reglages: r };
});
ipcMain.handle('soirees:desactiver', () => {
  lesSoirees().desactiver();
  config.sessionToken = '';        /* on repart sur un jeton tire au hasard */
  saveConfig();
  return { ok: true };
});

/* Ou en est l'analyse de fond, et pourquoi le widget dit ce qu'il dit. */
ipcMain.handle('analysis:state', () => {
  const n = library.length;
  const pret = library.filter(t => t.analyzed).length;
  return {
    library: n,
    analyses: pret,
    offline: analyse ? analyse.compterAbsents() : 0,
    /* Les points de mix ont maintenant leur propre bilan : l'ecran de
       sante peut dire « 0 sur 43 » au lieu de ne rien dire. */
    structure: { reussis: structSante.reussis, rates: structSante.rates,
                 erreur: structSante.derniereErreur },
    restants: dernierRapport ? dernierRapport.restants : (analyse ? analyse.file.size : 0),
    fils: analyse ? analyse.workers.length : 0,
    sansFils: analyse ? !!analyse.sansFils : false,
    importing: importing,
    /* La sante de l'analyse elle-meme : la fenetre de reglages doit
       pouvoir la montrer sans attendre qu'un morceau tourne. */
    panne: analyse ? analyse.panne() : null,
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
    bulle: bulleActive,
    repertoire: repCentre ? { centre: repCentre, ouvertes: repOuvertes } : null,
    limit: 3
  }).map(r => {
    reprendreStructure(r.track);
    ensureStructure(r.track, 1);
    return {
      id: r.track.id, title: r.track.title, artist: r.track.artist,
      key: r.track.key, bpm: r.track.bpm, energy: r.track.energy, path: r.track.path,
      total: r.total, why: r.why, introBars: r.introBars, client: !!r.client,
      transition: r.transition.n,
      bpmSource: r.track.bpmSource || null,
      keySource: r.track.keySource || null,
      bpmSur: r.track.bpmSource !== 'liaison-incertain',
      keySure: r.track.keySource !== 'liaison-incertain',
      bulle: r.bulle, horsBulle: bulleActive ? !r.dansBulle : false,
      /* Sans tempo sur le morceau en cours, cette division rendait NaN
         et le widget affichait « -NaN % » sur les cinq lignes : la
         correction du « rien ne se cale » redonnait des propositions
         que le DJ jugeait cassees. null se tait proprement. */
      delta: current.bpm > 0 ? Math.round((r.tempo.delta / current.bpm) * 1000) / 10 : null,
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
  /* ------------------------------------------------------------
     Rouvrir le panneau ne doit ni changer le QR, ni vider la file.

     Trois defauts se cumulaient ici, et le declencheur etait banal :
     le DJ rouvre les reglages a 1 h du matin pour remontrer le QR.

     1. Le jeton n'etait tire d'un tirage stable que si le DJ
        utilisait les fiches de soiree. Sinon, chaque demarrage en
        tirait un NEUF — et tous les QR deja affiches ou imprimes
        repondaient « lien invalide ».
     2. guests.clear() etait inconditionnel : demandes de la soiree,
        classement des plus demandes et quotas par telephone,
        effaces d'un coup. Le commentaire ne protegeait que la
        tracklist ; la file, elle, sautait.
     3. Aucun try : si le port etait deja pris, la promesse remontait
        jusqu'a un bouton sans catch — aucun message, et le serveur
        precedent venait d'etre arrete.

     On fixe donc le jeton une fois pour toutes, on ne vide qu'a
     l'ouverture d'une NOUVELLE soiree, et on attrape.
     ------------------------------------------------------------ */
  if (!config.sessionToken) {
    config.sessionToken = require('crypto').randomBytes(9).toString('base64url');
    saveConfig();
  }
  const nouvelleSoiree = !setlog || !setlog.current;
  guests.stop();
  let url;
  try {
  url = await guests.start({
    port: config.guestPort, sessionName: config.sessionName,
    token: config.sessionToken,
    cooldown: config.guestCooldown, maxPerDevice: config.guestMax,
    getLibrary: () => library,
    onRequest: () => {
      majTendances();
      send('requests', requestList());
      if (current) send('suggestions', computeSuggestions(config.suggestCount));
    }
  });
  } catch (err) {
    noterPanne('serveur des invites', err);
    return { error: 'Le serveur des invites n\'a pas pu demarrer : ' + err.message +
             '\nEssaie un autre port dans les reglages.' };
  }
  /* On n'ouvre une soiree que s'il n'y en a pas deja une en cours.
     Sans ca, un DJ qui affiche le QR une heure apres le debut coupait
     sa tracklist en deux et remettait a zero « ce que j'ai deja joue
     ce soir » : le filtre anti-repetition et le badge « tu l'as passe
     il y a vingt minutes » oubliaient la premiere heure. */
  if (!setlog) setlog = new SetLog(SETS());
  if (!setlog.current) {
    setlog.open(config.sessionName, config.pack);
    /* La soiree qui vient de se terminer entre dans la memoire des
       enchainements : elle comptera des ce soir. */
    oublierAffinites();
  }
  /* Et on repart d'une file de demandes vide : l'objet guests vit tant
     que l'app tourne — lancee au login, elle reste dans la barre de
     menus — donc les demandes du samedi et les quotas par telephone du
     samedi etaient encore la dimanche. */
  /* Uniquement quand la soiree commence vraiment. Rouvrir le panneau
     en cours de set n'efface plus ce que les invites ont demande. */
  if (nouvelleSoiree) guests.clear();
  majTendances();
  return { url: url, qr: await qrPNG(url), share: shareLinks(url, config.sessionName) };
});
ipcMain.handle('session:requests', () => requestList());
ipcMain.handle('share:open', (e, url) => { shell.openExternal(url); return true; });
ipcMain.handle('share:copy', (e, text) => { clipboard.writeText(text); return true; });
/* ============================================================
   Le glisser-deposer vers le deck.

   Le DJ attrape une suggestion dans le widget et la lache sur un
   deck de son logiciel de mix : le morceau se charge. C'est le
   geste que tout le monde connait, et c'est le chainon qui
   manquait — jusqu'ici il fallait retrouver le titre a la main
   dans sa bibliotheque, ce qui reprend les vingt secondes que
   Liaison venait de faire gagner.

   Point important pour ce qu'on promet par ailleurs : Liaison
   n'envoie toujours AUCUNE commande au logiciel de mix. On demande
   au systeme d'exploitation de demarrer un glisser de FICHIER,
   exactement comme si le DJ l'avait attrape dans son explorateur.
   C'est lui qui le tire, c'est lui qui le lache, c'est son logiciel
   qui decide d'en faire quelque chose. Rien n'est pilote.

   Et ce n'est pas compte. Un glisser ne nous coute rien : le
   limiter n'aurait aucune autre raison que de forcer un achat.
   ============================================================ */
let iconeGlisser = null;
function iconeDeGlisser() {
  if (iconeGlisser) return iconeGlisser;
  try {
    const p = path.join(__dirname, '..', 'build', 'icon-256.png');
    let img = nativeImage.createFromPath(p);
    if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
    /* macOS refuse une icone trop grande et Windows la deforme :
       64 px est la taille que les deux acceptent sans broncher. */
    iconeGlisser = img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 64, height: 64 });
  } catch (e) { iconeGlisser = nativeImage.createEmpty(); }
  return iconeGlisser;
}

/* startDrag ne rend rien et doit partir pendant l'evenement dragstart :
   on passe donc par send(), pas par invoke(). */
ipcMain.on('drag:track', (e, id) => {
  try {
    const t = library.find(x => x.id === id);
    if (!t || !t.path) return;
    if (!fs.existsSync(t.path)) {
      send('toast', { texte: 'Le fichier a bouge sur le disque — relance une lecture de bibliotheque.', rouge: true });
      return;
    }
    e.sender.startDrag({ file: t.path, icon: iconeDeGlisser() });
  } catch (err) { noterPanne('glisser-deposer', err); }
});

/* Le widget demande si un morceau est glissable avant d'afficher la poignee. */
ipcMain.handle('drag:possible', (e, id) => {
  const t = library.find(x => x.id === id);
  return !!(t && t.path);
});

ipcMain.handle('qr:save', async (e, dataUrl) => {
  const r = await dialog.showSaveDialog({ defaultPath: 'liaison-qr.png' });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
  return r.filePath;
});

/* ============================================================
   Les filtres de cabine
   ============================================================ */
ipcMain.handle('filters:get', () => etatFiltres());

ipcMain.handle('filters:set', (e, patch) => {
  const p = patch || {};
  const a = k => Object.prototype.hasOwnProperty.call(p, k);

  /* Les filtres de soiree. Ils tiennent jusqu'a ce que le DJ les
     retire lui-meme, donc ils vont sur le disque. */
  for (const k of ['fCrate', 'fSkipPlayed', 'fNoExplicit', 'fBpmMin', 'fBpmMax'])
    if (a(k)) config[k] = p[k];

  /* ------------------------------------------------------------
     Les filtres d'instant.

     « Genre faudrait qu'on puisse acceder aux filtres pour dire
       "okay fait moi des propositions de sons avec tel genre, avec
       tel marge de BPM, etc". Une fois que le son est joue, les
       filtres retournent par defaut. »

     Ils sont bornes ici et nulle part ailleurs, parce que c'est la
     seule porte d'entree : le widget peut envoyer une marge a 400
     ou une energie a -3, le moteur ne les verra jamais. Une marge
     au-dela de 12 % n'est plus un filtre de tempo — a ce compte-la
     tout passe, et le DJ croit avoir regle quelque chose.
     ------------------------------------------------------------ */
  if (a('fGenres'))
    config.fGenres = Array.isArray(p.fGenres)
      ? p.fGenres.map(x => String(x || '').trim()).filter(Boolean).slice(0, 12)
      : [];
  if (a('fMarge'))    config.fMarge     = Math.max(0, Math.min(12, Math.round(Number(p.fMarge) || 0)));
  if (a('fEnergyMin')) config.fEnergyMin = Math.max(0, Math.min(10, Math.round(Number(p.fEnergyMin) || 0)));
  if (a('fEnergyMax')) config.fEnergyMax = Math.max(0, Math.min(10, Math.round(Number(p.fEnergyMax) || 0)));
  /* Une plage a l'envers (min 8, max 3) ne laisse rien passer et
     ressemble a une panne. On la remet a l'endroit plutot que de
     vider le widget. */
  if (config.fEnergyMin && config.fEnergyMax && config.fEnergyMin > config.fEnergyMax) {
    const t = config.fEnergyMin; config.fEnergyMin = config.fEnergyMax; config.fEnergyMax = t;
  }

  saveConfig();
  if (current) send('suggestions', computeSuggestions(config.suggestCount));
  /* On renvoie l'etat COMPLET, pas seulement les compteurs : apres
     une correction de bornes comme celle du dessus, le widget doit
     repeindre ce que Liaison a vraiment retenu, et non ce qu'il
     croyait avoir envoye. */
  const et = etatFiltres();
  send('filters', et);
  return et;
});

/* ------------------------------------------------------------
   Les styles proposes au DJ sont les SIENS.

   « pour les styles, prend ceux de la bibliotheque du dj (itunes,
     rekordbox, etc.. car chaque dj a son habitude) »

   Une liste maison — « House / Techno / Disco / Funk » — se serait
   trompee deux fois : elle aurait propose des cases vides chez un
   DJ mariage, et elle aurait rate « Variete francaise », « Zouk »,
   « Afro », « Rai » chez celui qui en vit. Les etiquettes viennent
   donc de la bibliotheque lue, dans l'orthographe du DJ, triees
   par nombre de morceaux : ce qu'il voit en haut de la liste est
   ce qu'il joue le plus.
   ------------------------------------------------------------ */
ipcMain.handle('filters:genres', () => genresmod.genresDuDJ(library, 18));

/* ============================================================
   TITRES A AVOIR.

   Trois blocs qui ne se melangent jamais : ce que TA salle a
   reclame, ce que le client impose, et ce que le monde ecoute.
   Les deux premiers sont verifiables sur cette machine ; le
   troisieme vient de l'exterieur et est annonce comme tel.

   Le classement n'est demande que si on le veut (le panneau le
   demande explicitement) : ouvrir la rubrique ne doit pas
   declencher un appel reseau a chaque fois.
   ============================================================ */
ipcMain.handle('aavoir:get', async (e, opt) => {
  const o = opt || {};
  const j = chargerJournal();

  /* 1. La salle. */
  const salle = aavoir.manques(j, {
    library: library, match: engine.match,
    buyLinks: acquire.buyLinks, nearMisses: acquire.nearMisses,
    limite: 40
  });

  /* 2. Le client : ses titres imposes qui ne matchent rien. On
     reutilise le calcul existant plutot que d'en refaire un —
     deux chemins pour un meme chiffre finissent par diverger. */
  let client = [];
  try { client = (clientSet && clientSet.stats && clientSet.stats.manquants) || []; }
  catch (err) { client = []; }

  /* ------------------------------------------------------------
     3. Le classement.

     Il se charge par defaut : le bouton « voir le classement »
     demandait au DJ de reclamer une information qu'il etait venu
     chercher. On passe `classement: false` seulement quand on
     rafraichit la liste locale apres un oubli, pour ne pas
     rappeler le service pour rien.
     ------------------------------------------------------------ */
  let classement = { etat: 'non-demande', titres: [] };
  if (o.classement !== false) {
    /* Le pays force par le DJ gagne sur celui du contexte. */
    const pays = String(o.pays || config.chartsPays || '').toLowerCase()
              || charts.paysDe(config.pack);
    const garde = chargerClassements();
    const eu = garde[pays];
    let brut = null, depuis = 0, horsLigne = false;

    if (eu && eu.valeur && !o.forcer) {
      /* Servi du disque, sans toucher au reseau. C'est le cas
         normal : on n'appelle le relais que la premiere fois pour
         un pays, ou quand le DJ le demande. */
      brut = eu.valeur;
      depuis = eu.quand || 0;
    } else {
      const neuf = await charts.charger({
        fournisseur: config.chartsFournisseur,
        cle: config.chartsCle,
        pack: config.pack,
        pays: pays,
        limite: 50
      });
      if (neuf && neuf.etat === 'ok') {
        garde[pays] = { quand: Date.now(), valeur: neuf };
        enregistrerClassements();
        brut = neuf;
        depuis = garde[pays].quand;
      } else if (eu && eu.valeur) {
        /* L'appel a echoue mais on avait quelque chose : on le sert
           plutot que de vider l'ecran. Un DJ dans un train doit
           continuer a voir ce qui lui manque — c'est justement la
           que la liste sert. */
        brut = eu.valeur;
        depuis = eu.quand || 0;
        horsLigne = true;
      } else {
        brut = neuf;
      }
    }

    /* LA CONFRONTATION, ELLE, EST TOUJOURS REFAITE.
       C'est ce qui fait qu'un morceau telecharge depuis la
       derniere ouverture sort de la liste des manques sans qu'on
       ait redemande quoi que ce soit a l'exterieur. */
    classement = aavoir.tamiser(brut, {
      library: library, match: engine.match,
      buyLinks: acquire.buyLinks, limite: 25
    });
    classement.depuis = depuis || null;
    classement.tiede = !!(depuis && (Date.now() - depuis) > CHARTS_TIEDE);
    classement.horsLigne = horsLigne;
    /* D'ou vient ce qu'on affiche, et si on a reussi a le garder.
       Sans ca, « la liste n'est pas restee » et « la liste n'a
       jamais ete ecrite » se ressemblent trop. */
    classement.garde = classementsEcritKO ? 'echec' : (brut === (eu && eu.valeur) ? 'disque' : 'reseau');
    classement.gardeNote = classementsEcritKO;
  }

  return {
    salle: salle, client: client, classement: classement,
    total: salle.length + client.length,
    /* De quoi expliquer un panneau vide sans faire chercher une
       panne : zero manque quand personne n'a encore rien demande
       n'est pas la meme chose que zero manque apres dix soirees. */
    soirees: Object.keys(j).length ? null : 'aucune demande enregistree pour l\'instant',
    /* De quoi remplir le menu des pays, et dire lequel est
       actuellement servi — force a la main ou deduit du contexte. */
    pays: {
       liste: charts.listePays(),
       choisi: String(config.chartsPays || '').toLowerCase(),
       parDefaut: charts.paysDe(config.pack)
    }
  };
});

/* Oublier un titre : le DJ ne veut pas l'acheter, point. Sans ce
   bouton, une liste de courses devient une liste de reproches. */
ipcMain.handle('aavoir:oublier', (e, entree) => {
  const j = chargerJournal();
  const cle = aavoir.cleDe(entree && entree.artist, entree && entree.title);
  if (j[cle]) { delete j[cle]; enregistrerJournal(); }
  return { ok: true, restants: Object.keys(j).length };
});

/* Oublier le classement garde d'un pays, pour forcer une relecture
   propre. Rarement utile, mais le seul moyen de repartir de zero
   sans supprimer un fichier a la main. */
ipcMain.handle('aavoir:oublierClassements', () => {
  chartsDisque = {};
  enregistrerClassements();
  return { ok: true };
});

ipcMain.handle('aavoir:vider', () => {
  journalManques = {};
  enregistrerJournal();
  return { ok: true };
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
  if (!m) { landPlan = null; landAt = 0; if (current) send('suggestions', computeSuggestions(config.suggestCount));
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
  if (current) send('suggestions', computeSuggestions(config.suggestCount));
  return Object.assign({}, landPlan, { phase: landingNow() });
});

ipcMain.handle('landing:get', () =>
  landPlan && landPlan.ok
    ? Object.assign({}, landPlan, { phase: landingNow(), revue: clotureRevue })
    : null);

ipcMain.handle('landing:clear', () => {
  landPlan = null; landAt = 0;
  if (current) send('suggestions', computeSuggestions(config.suggestCount));
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

ipcMain.handle('prepare:build', async (e, opt) => {
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
  dernierePrepa = await prepare.preparer({
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
/* ------------------------------------------------------------
   Le debrief de fin de soiree.

   Personne ne donne jamais de retour a un DJ sur ce qu'il vient de
   jouer. Liaison a tout note — l'heure, la duree reelle, le tempo,
   la tonalite, l'energie, les genres. Il ne juge pas : il mesure,
   et il rend des phrases.
   ------------------------------------------------------------ */
/* Le debrief est vendu avec Resident, et il l'etait deja sur le site :
   il n'etait simplement pas ferme dans l'app. On le ferme — mais on
   OFFRE le premier, une fois, en le disant.

   Ce n'est pas une astuce de vente : c'est la seule facon honnete de
   vendre un debrief. Personne ne peut juger sur une capture d'ecran ce
   que valent les chiffres de SA soiree ; il faut les avoir vus une
   fois. Celui qui n'accroche pas garde une app gratuite entiere, et
   celui qui accroche sait exactement ce qu'il achete. */
ipcMain.handle('sets:debrief', (e, id) => {
  if (!setlog) return null;
  const s = (id ? setlog.get(Number(id)) : null) || setlog.current;
  if (!s) return null;
  const D = debriefmod.debrief(s, { demandes: guests.top() });
  if (!D) return { court: true, morceaux: (s.played || []).length };

  const droit = moments.debriefAutorise({
    replay: !!feat().replay,
    dejaOffert: license.state.debriefOffert
  });
  if (!droit.ok) {
    return { locked: true,
      error: 'Le debrief complet fait partie de Resident. Le premier t\'a ete offert — ' +
             'celui-la, il faut une licence.' };
  }
  if (droit.offert) {
    license.state.debriefOffert = Date.now();
    license._save();
  }
  return { debrief: D, phrases: debriefmod.enPhrases(D), offert: droit.offert };
});

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
/* ============================================================
   LA FENETRE CHANGE DE TAILLE EN DOUCEUR.

   « j'adore le fait que si on ouvre le filtre, le widget
     s'agrandit ou retrecit, mais j'ajouterais une sorte
     d'animation hyper smooth »

   Une feuille de style ne peut pas animer la taille d'une
   FENETRE : c'est le systeme qui la dessine, pas la page. Le
   widget sautait donc de 396 a 563 px d'un coup, ce qui se lit
   comme un a-coup meme quand tout le reste glisse.

   On interpole donc les bornes nous-memes, sur douze images. La
   courbe est celle du CSS d'en face (cubic-bezier .16 1 .3 1,
   sortie rapide, arrivee posee) pour que le contenu et le cadre
   fassent UN seul geste et pas deux.

   Trois garde-fous, tous appris a la dure :

     — un saut de moins de 8 px n'est pas anime : le widget se
       reajuste de deux ou trois pixels a chaque changement de
       morceau, et animer ca donnerait une fenetre qui respire en
       permanence ;
     — une nouvelle demande annule la precedente, sinon deux
       animations se disputent les memes bornes et la fenetre
       tremble ;
     — le minuteur est arrete des que la fenetre disparait. Une
       animation sur une fenetre detruite, c'est un plantage.
   ============================================================ */
let tweenHauteur = null;
const HAUTEUR_IMAGES = 12;          /* ~180 ms a 60 images/seconde */
const HAUTEUR_SEUIL = 8;            /* en deca, on ne bouge pas en douceur */

function douceur(t) {
  /* cubic-bezier(.16, 1, .3, 1), approchee : meme depart nerveux,
     meme arrivee amortie que l'animation du tiroir. */
  return 1 - Math.pow(1 - t, 3);
}

function poserHauteur(win, cible) {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const h = Math.max(120, Math.min(900, Math.round(cible)));
  if (Math.abs(b.height - h) < 1) return;

  if (tweenHauteur) { clearInterval(tweenHauteur); tweenHauteur = null; }

  /* Un petit reajustement se fait sec : c'est imperceptible, et
     l'animer ferait vibrer le widget a chaque morceau. */
  if (Math.abs(b.height - h) < HAUTEUR_SEUIL || !win.isVisible()) {
    win.setBounds(Object.assign(b, { height: h }));
    return;
  }

  const depart = b.height;
  let i = 0;
  tweenHauteur = setInterval(() => {
    if (!win || win.isDestroyed()) { clearInterval(tweenHauteur); tweenHauteur = null; return; }
    i++;
    const t = Math.min(1, i / HAUTEUR_IMAGES);
    const v = Math.round(depart + (h - depart) * douceur(t));
    try { win.setBounds(Object.assign(win.getBounds(), { height: v })); } catch (err) {}
    if (t >= 1) { clearInterval(tweenHauteur); tweenHauteur = null; }
  }, 16);
  if (tweenHauteur.unref) tweenHauteur.unref();
}

ipcMain.handle('widget:height', (e, h) => {
  const from = BrowserWindow.fromWebContents(e.sender);
  /* Plancher a 120 px : au cran BARRE le widget n'est plus qu'une
     reglette posee au-dessus des decks, et 220 px l'auraient
     rallonge d'une centaine de pixels de vide noir. */
  poserHauteur(from || widget, h);
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
    const opts = kind === 'prolink'
      ? { announce: config.prolinkAnnounce, autorise: reseauDeckLibre }
      : config.sourceOpts;
    now.start(kind, opts);
    /* rekordbox : on ecoute le reseau ET les fichiers ouverts.
       Sous Windows la seconde source n'existe pas — elle le dit
       elle-meme, ce qui vaut mieux qu'un widget muet. */
    /* Avec rekordbox, les deux marchent ensemble : le reseau quand il
       est libre, les fichiers ouverts sinon. C'est ce qui permet de
       rendre le port sans laisser le widget muet. */
    if (kind === 'prolink') startRekordboxFichiers(); else stopRekordboxFichiers();
    if (config.autoLibrary && !library.length) await autoImport(app_.librarySource);
    refreshTray();
  });
  /* ------------------------------------------------------------
     Fermer un logiciel n'eteint pas Liaison si un autre tourne.

     « open » n'est emis qu'a la transition absent -> present. Donc :
     Serato ouvert depuis 19 h, le DJ lance rekordbox a 23 h (Liaison
     bascule dessus), puis quitte rekordbox a 1 h. On eteignait tout —
     et comme Serato n'a jamais disparu, il ne pouvait plus emettre
     « open ». Plus aucune detection jusqu'a ce qu'on relance Serato
     ou Liaison. En pleine soiree.

     On reprend donc le premier logiciel encore ouvert, et on ne
     s'eteint que s'il n'y en a plus aucun.
     ------------------------------------------------------------ */
  async function reprendre(app_) {
    activeApp = app_;
    send('app', { id: app_.id, label: app_.label, open: true });
    if (config.autoWidget && widget) { widget.show(); widget.setAlwaysOnTop(true, 'screen-saver'); }
    const kind = app_.nowSource;
    config.source = kind; saveConfig();
    const opts = kind === 'prolink'
      ? { announce: config.prolinkAnnounce, autorise: reseauDeckLibre }
      : config.sourceOpts;
    try { now.start(kind, opts); } catch (e) { noterPanne('reprise de source ' + kind, e); }
    /* Avec rekordbox, les deux marchent ensemble : le reseau quand il
       est libre, les fichiers ouverts sinon. C'est ce qui permet de
       rendre le port sans laisser le widget muet. */
    if (kind === 'prolink') startRekordboxFichiers(); else stopRekordboxFichiers();
    refreshTray();
  }

  watcher.on('close', app_ => {
    if (activeApp && activeApp.id === app_.id) {
      now.stop();
      stopRekordboxFichiers();
      current = null;
      /* Le widget gardait l'ancien morceau a l'ecran, et se croyait
         donc en mesure de poser ou de recentrer une bulle. On dit
         explicitement qu'il n'y a plus rien qui tourne. */
      send('now', null);
      /* Et la liste avec. Sans ca, l'ecran se contredisait : l'entete
         disait « en attente » pendant que cinq propositions et leurs
         reperes de mix — « lance a 2:34 » — restaient affiches pour
         un morceau qui n'est plus sur le deck. */
      send('suggestions', []);
      send('app', { id: app_.id, label: app_.label, open: false });
      const restants = watcher.current().filter(a => a.id !== app_.id);
      if (restants.length) {
        activeApp = null;
        reprendre(restants[0]);
        refreshTray();
        return;
      }
      activeApp = null;
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

/* ============================================================
   UNE SEULE LIAISON A LA FOIS.

   Rapporte par le premier acheteur : « pour installer la nouvelle
   version j'ai du desinstaller l'ancienne et redemarrer le PC car
   il m'en ouvrait 5 ».

   Il n'y avait aucun verrou d'instance. Chaque double-clic, chaque
   relance par l'installeur, chaque entree de demarrage ouvrait une
   application COMPLETE de plus. Cinq Liaison, c'est :

     — cinq lectures de la bibliotheque en parallele sur le meme
       disque, qui se disputent la tete de lecture ;
     — cinq processus qui reecrivent le MEME config.json et le meme
       cache de scan : le dernier ecrit gagne, les reglages des
       autres sont perdus ;
     — cinq widgets, dont celui qu'on regarde n'est pas forcement
       celui qui a lu le deck.

   Ce dernier point explique le symptome le plus deroutant :
   « meme avec un titre charge sur le deck, il affiche toujours
   l'ancien ». Le widget visible appartenait a une instance restee
   sur son etat d'il y a une heure.

   Le verrou doit etre pris AVANT tout le reste — avant de lire la
   config, avant d'ouvrir une fenetre — sinon la deuxieme instance
   a deja ecrit dans les fichiers de la premiere quand elle
   s'apercoit qu'elle est de trop.

   Et relancer l'application n'est pas une erreur de l'utilisateur :
   c'est ainsi qu'on redemande un widget qu'on a masque. La seconde
   instance sert donc a RAMENER la premiere.
   ============================================================ */
/* On retient la reponse plutot que d'interroger Electron plus tard :
   hasSingleInstanceLock() n'existe pas partout, et un garde-fou qui
   depend d'une API absente saute le demarrage entier — ce qui est
   pire que le defaut qu'il corrige. */
const SEULE_INSTANCE = app.requestSingleInstanceLock();
if (!SEULE_INSTANCE) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (widget) {
      if (widget.isMinimized()) widget.restore();
      widget.show();
      widget.setAlwaysOnTop(true, 'screen-saver');
      widget.focus();
    }
  });
}

app.whenReady().then(async () => {
  /* Si le verrou n'a pas ete obtenu, app.quit() est deja demande :
     on ne demarre pas une deuxieme fois par-dessus. */
  if (!SEULE_INSTANCE) return;
  loadConfig();
  buildMenu();
  license = new License(LIC());
  setlog = new SetLog(SETS());
  /* ------------------------------------------------------------
     L'essai a besoin de savoir combien de vraies soirees ont ete
     jouees — c'est ce qui decide maintenant quand il se ferme.

     license.js ne connait pas setlog et n'a aucune raison de le
     connaitre : on lui branche une fonction, il l'appelle quand
     il en a besoin. C'est aussi ce qui permet aux essais de
     poser n'importe quel nombre de soirees sans fabriquer de
     journal de sets.

     L'ORDRE COMPTE : setlog doit exister avant ensureTrial(),
     sinon le premier calcul de l'essai se fait avec zero soiree.
     Sans consequence aujourd'hui — zero est la reponse genereuse
     — mais c'est le genre de dependance silencieuse qui se paie
     le jour ou la regle change de sens.
     ------------------------------------------------------------ */
  license.soirees = () => { try { return setlog.soireesJouees(); } catch (e) { return 0; } };
  license.ensureTrial();
  structCache = new StructureCache(STRUCT());
  createWidget();
  if (config.autoWidget) widget.hide();          // le widget attend son logiciel
  buildTray();
  wireWatcher();
  poserRaccourci();

  if (config.launchAtLogin && app.setLoginItemSettings) {
    try { app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true }); } catch (e) {}
  }

  license.refresh(false).then(() => {
    send('license', license.status());
    refreshTray();
  });

  /* La file des incidents part ICI, et nulle part ailleurs : au
     demarrage, avant qu'un logiciel de mix soit ouvert. C'est le
     seul moment ou un envoi ne peut pas tomber pendant un set.
     Le decalage laisse l'ouverture du widget passer devant — un
     rapport de panne ne merite pas de retarder ce pour quoi
     l'app existe. */
  const minuteurIncidents = setTimeout(() => { envoyerIncidents(); }, 6000);
  if (minuteurIncidents.unref) minuteurIncidents.unref();
  if (!license.state.seenWelcome) {
    license.state.seenWelcome = Date.now();
    license._save();
    openLicence('welcome');
  }
  if (config.autoLibrary) autoImport().then(refreshTray);
  else if (config.libraryPath) importLibrary(config.libraryMode, config.libraryPath)
    .then(refreshTray)
    /* Le fichier a pu etre deplace ou reexporte depuis la derniere fois.
       Sans ce catch, le rejet remontait au filet global : fenetre
       « Liaison a rencontre un probleme » au demarrage, bibliotheque
       vide, et aucune indication de ce qu'il fallait faire. */
    .catch(e => {
      send('status', { ok: false, msg: 'Bibliotheque introuvable — verifie le chemin dans les reglages' });
      noterPanne('import de bibliotheque', e);
    });

  /* On ne demande pas au lancement : les vingt premieres secondes
     appartiennent au scan de bibliotheque et au branchement du
     logiciel de mix. Ensuite, deux fois par jour suffisent — une
     version ne sort pas toutes les heures. */
  setTimeout(regarderLesMaj, 20000);
  setInterval(regarderLesMaj, 12 * 3600 * 1000);
  setTimeout(regarderLEssai, 45000);
  setInterval(regarderLEssai, 3600 * 1000);
});

/* ============================================================
   Les mises a jour.

   Rien ne se telecharge et rien ne se remplace tout seul : une
   mise a jour qui se declenche a une heure du matin devant deux
   cents personnes, c'est exactement ce qu'il ne faut pas. On
   previent, une fois par version, et le DJ choisit son moment.
   ============================================================ */
let derniereMaj = null;

/* ============================================================
   Les deux moments qui decident si quelqu'un reste.

   Un essai de sept jours qui s'arrete sans rien dire est un client
   perdu en silence : depuis qu'il n'y a plus de formule gratuite,
   l'application ne se degrade pas, elle se VERROUILLE — et le DJ en
   conclut que « ca marche plus ». On le lui dit donc, deux
   fois, et jamais plus.

   J-3 : un mot dans le widget. Pas une fenetre, pas un compte a
   rebours rouge — un rappel, avec ce qu'il a reellement fait avec.

   Le passage en gratuit : une fenetre, une seule fois, et JAMAIS
   pendant un set en cours. Interrompre un DJ en soiree pour lui
   parler d'argent est la meilleure facon de le perdre pour de bon.
   ============================================================ */
function bilanUsage() {
  let sets = [];
  try { sets = setlog.list() || []; } catch (e) {}
  const minutes = sets.reduce((a, s) => a + (s.duree || 0), 0);
  const d = (gout && gout.d) || {};
  return {
    sets: sets.length,
    heures: Math.round(minutes / 60),
    enchainements: d.n || 0,
    pris: d.pris || 0,
    titres: Array.isArray(library) ? library.length : 0
  };
}
ipcMain.handle('stats:bilan', () => bilanUsage());

/* Les tarifs du jour, avec un cache d'une heure : la fenetre de
   licence peut s'ouvrir dix fois dans une soiree, le prix ne bouge
   pas dix fois. */
let tarifsCache = null, tarifsQuand = 0;
ipcMain.handle('tarifs:get', async () => {
  const n = Date.now();
  if (tarifsCache && n - tarifsQuand < 3600000) return tarifsCache;
  try {
    tarifsCache = await require('./license').tarifs();
    tarifsQuand = n;
  } catch (e) {
    tarifsCache = tarifsCache || require('./license').TARIFS_REPLI;
  }
  return tarifsCache;
});

function regarderLEssai() {
  try {
    /* D'abord la prolongation : elle change trialLeft, donc elle doit
       etre decidee avant qu'on lise l'etat pour les deux annonces. */
    const b0 = bilanUsage();
    const av = license.status();
    const pro = moments.prolongationDue({
      tier: av.tier, trialLeft: av.trialLeft, trialStart: license.state.trialStart,
      sets: b0.sets, dejaProlonge: license.state.prolonge
    });
    /* pro.prolonger ne se declenche plus : prolongationDue() exige
       trialLeft === 0, et trialLeft ne tombe a zero qu'une fois
       les deux soirees jouees — c'est-a-dire exactement le cas ou
       prolongationDue() refuse. Le chemin est garde en place pour
       les installations qui avaient deja recu leur prolongation
       et dont l'etat le mentionne encore. */
    if (pro.prolonger && !setlog.current) {
      license.state.prolonge = Date.now();
      license.state.prolongeJours = pro.jours;
      /* La fenetre de fin n'a plus lieu d'etre : l'essai continue. */
      license.state.vuRappelEssai = 0;
      license._save();
      send('license', license.status());
      send('toast', { texte: moments.phraseProlongation(b0.sets) });
      refreshTray();
      return;
    }

    const st = license.status();
    const quoi = moments.aMontrer({
      tier: st.tier,
      trialLeft: st.trialLeft,
      trialStart: license.state.trialStart,
      vuRappel: license.state.vuRappelEssai,
      vuFin: license.state.vuFinEssai,
      setEnCours: !!setlog.current
    });
    if (quoi.rappel) {
      license.state.vuRappelEssai = Date.now();
      license._save();
      send('toast', { texte: moments.phraseRappel(st.trialLeft, b0) });
    }
    if (quoi.fin) {
      license.state.vuFinEssai = Date.now();
      license._save();
      openLicence('plans');
    }
  } catch (e) { noterPanne('suivi de l\'essai', e); }
}

async function regarderLesMaj() {
  let r;
  try { r = await maj.verifier(app.getVersion(), require('./license').API_LISTE || [require('./license').API]); }
  catch (e) { return; }
  if (!r || r.aJour) return;
  derniereMaj = r;
  /* Une version refusee ne revient pas a chaque lancement. La
     suivante, si. */
  if (config.majIgnoree === r.version) return;
  send('maj', r);
}

ipcMain.handle('maj:etat', async () => {
  if (!derniereMaj) {
    try { derniereMaj = await maj.verifier(app.getVersion(), require('./license').API_LISTE || []); } catch (e) {}
  }
  return { courante: app.getVersion(), info: derniereMaj };
});
/* ============================================================
   METTRE A JOUR SANS LAISSER DEUX LIAISON DERRIERE SOI.

   Rapporte par le premier acheteur, sur Windows : « pour
   installer la nouvelle version j'ai du desinstaller l'ancienne
   et redemarrer le PC car il m'en ouvrait 5 ».

   La mise a jour se contentait d'ouvrir la page de
   telechargement. Le DJ lancait donc l'installateur PENDANT que
   Liaison tournait — et sous Windows, on ne remplace pas un
   fichier .exe en cours d'execution. L'installateur echoue a
   moitie, l'ancienne version reste en memoire, et on se retrouve
   avec deux installations et plusieurs fenetres.

   Sur macOS le probleme ne se voit pas : on glisse l'app dans
   Applications et le systeme s'arrange. Encore une panne que la
   machine de developpement ne montre jamais.

   On ne laisse donc plus ce piege ouvert : on previent, et on
   propose de fermer Liaison tout de suite. Le DJ garde le choix —
   il est peut-etre en pleine soiree.
   ============================================================ */
ipcMain.handle('maj:ouvrir', async () => {
  const page = (derniereMaj && derniereMaj.page) || 'https://liaisondj.app/telecharger';
  shell.openExternal(page);

  /* En pleine soiree, on ne propose rien du tout : une boite de
     dialogue par-dessus la cabine serait pire que le probleme.
     « setlog.current » est deja ce qui sert ailleurs a savoir
     qu'un set tourne — on ne reinvente pas le critere. */
  if (setlog && setlog.current) return { ouvert: true, ferme: false, raison: 'soiree' };

  const r = await dialog.showMessageBox({
    type: 'info',
    title: 'Mise a jour de Liaison',
    message: 'Ferme Liaison avant de lancer l\'installateur.',
    detail: process.platform === 'win32'
      ? 'Windows ne peut pas remplacer une application en cours d\'execution : si Liaison tourne '
        + 'pendant l\'installation, l\'ancienne version peut rester en place.\n\n'
        + 'La page de telechargement vient de s\'ouvrir. Tu peux fermer Liaison maintenant, '
        + 'puis lancer le fichier telecharge.'
      : 'La page de telechargement vient de s\'ouvrir. Ferme Liaison, remplace-le dans '
        + 'Applications, puis relance-le.',
    buttons: ['Fermer Liaison maintenant', 'Plus tard'],
    defaultId: 0, cancelId: 1
  }).catch(() => ({ response: 1 }));

  if (r.response === 0) {
    /* On laisse le navigateur finir d'ouvrir la page avant de
       partir, sinon le DJ se retrouve sans rien a l'ecran. */
    setTimeout(() => { app.quit(); }, 1200);
    return { ouvert: true, ferme: true };
  }
  return { ouvert: true, ferme: false };
});
ipcMain.handle('maj:ignorer', (e, version) => {
  config.majIgnoree = String(version || '');
  saveConfig();
  return true;
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

  /* ------------------------------------------------------------
     La panne est aussi mise de cote pour un envoi EVENTUEL.

     Mise de cote, pas envoyee : rien ne part tant que le DJ n'a
     pas dit oui, et meme alors la file n'est videe qu'au
     demarrage suivant. On empile donc toujours — y compris avant
     d'avoir une reponse — parce qu'une panne qui tue le
     processus doit pouvoir etre racontee au prochain lancement.
     Si la reponse est non, la file est effacee sans jamais avoir
     ete lue par personne.
     ------------------------------------------------------------ */
  try {
    const inc = incidents.batir(quoi, err, app.getVersion(), process.platform);
    if (inc) incidents.empiler(ecrire, DIR(), inc);
  } catch (e) {}

  if (dejaPrevenu) return;
  dejaPrevenu = true;

  /* ------------------------------------------------------------
     ON DEMANDE AU MOMENT OU C'EST CONCRET.

     L'accord d'envoi se demande ICI, dans la fenetre de panne, et
     pas au premier lancement. Au premier lancement, « acceptez-vous
     l'envoi de rapports anonymes » est une case qu'on coche sans
     lire. Au moment d'une panne, la question a un objet : il vient
     de se passer quelque chose, on propose de le raconter, et le
     DJ voit exactement ce qu'il autorise.

     Trois reponses, et « Non » est la reponse par defaut de la
     touche Echap.
     ------------------------------------------------------------ */
  const choix = config.rapportPannes;          /* 'oui' | 'non' | undefined */
  const boutons = choix === undefined
    ? ['Ne rien envoyer', 'Envoyer ce rapport', 'Toujours envoyer']
    : ['Continuer', 'Ouvrir le journal'];
  try {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Liaison a rencontre un probleme',
      message: 'Liaison continue de tourner.',
      detail: choix === undefined
        ? 'Un incident a ete note. Si quelque chose ne repond plus, ferme et rouvre l\'app.\n\n' +
          'Tu peux m\'aider a le corriger en envoyant un rapport ANONYME : la version, ton systeme, ' +
          'et la trace technique. Jamais un titre, jamais un nom de fichier, jamais ton nom. ' +
          'L\'envoi se fait au prochain demarrage, jamais pendant que tu mixes.\n\n' +
          'Le detail est dans :\n' + path.join(DIR(), 'pannes.log')
        : 'Un incident a ete note. Si quelque chose ne repond plus, ferme et rouvre l\'app.\n\n' +
          'Le detail est dans :\n' + path.join(DIR(), 'pannes.log'),
      buttons: boutons,
      defaultId: 0, cancelId: 0
    }).then(r => {
      const i = r ? r.response : 0;
      if (choix === undefined) {
        if (i === 0) { config.rapportPannes = 'non'; saveConfig(); incidents.vider(ecrire, DIR()); }
        else if (i === 1) { config.rapportPannes = 'une'; saveConfig(); }
        else if (i === 2) { config.rapportPannes = 'oui'; saveConfig(); }
      } else if (i === 1) {
        try { shell.showItemInFolder(path.join(DIR(), 'pannes.log')); } catch (e) {}
      }
    }).catch(() => {});
  } catch (e) {}
}

/* ============================================================
   L'ENVOI, AU DEMARRAGE ET NULLE PART AILLEURS.

   « Aucune requete reseau pendant le set » est une promesse de
   la page d'accueil. Elle reste vraie au mot pres : la file est
   videe ici, une fois, au lancement — avant meme qu'un logiciel
   de mix soit ouvert — et jamais ensuite.

   Tout ce qui peut echouer echoue en silence. Un rapport de
   panne qui fait ramer le demarrage est un defaut de plus, et il
   toucherait tout le monde plutot qu'une minorite.
   ============================================================ */
async function envoyerIncidents() {
  const choix = config.rapportPannes;
  if (choix !== 'oui' && choix !== 'une') return;
  let file = [];
  try { file = incidents.lire(ecrire, DIR()); } catch (e) { return; }
  if (!file.length) return;
  /* « Envoyer ce rapport » ne vaut que pour celui-la : on vide la
     permission avant l'envoi, pour qu'un echec ne la fasse pas
     durer une fois de plus. */
  if (choix === 'une') { config.rapportPannes = 'non'; saveConfig(); }
  try {
    const r = await incidents.envoyer(
      (process.env.LIAISON_API || 'https://liaisondj.app') + '/api/etat',
      { incidents: file.slice(0, incidents.FILE_MAX) },
      incidents.DELAI_MS);
    /* On ne vide QUE si le serveur a pris : sinon la file repart
       au prochain lancement, ce qui est exactement ce qu'on veut
       pour un DJ qui n'avait pas de reseau ce soir-la. */
    if (r && r.code >= 200 && r.code < 300) incidents.vider(ecrire, DIR());
  } catch (e) { /* silence : ce n'est pas au DJ de s'en occuper */ }
}
process.on('uncaughtException', e => noterPanne('exception non attrapee', e));
process.on('unhandledRejection', e => noterPanne('promesse rejetee', e));

app.on('window-all-closed', () => { /* Liaison vit dans la barre de menus */ });
app.on('activate', () => {
  if (!widget) createWidget();
  if (settings && !settings.isDestroyed()) settings.focus();
  else openSettings();
});
/* ============================================================
   Le couvercle qu'on referme pendant le repas.

   Rien ne reagissait a la veille. Trois choses en souffraient, et
   toutes les trois se voient au pire moment — quand le DJ relance
   la piste apres le service :

   — la socket Pro DJ Link est liee une fois et jamais recreee. Si
     la pile reseau perd son abonnement multicast au reveil, plus
     aucun paquet n'arrive : Liaison repete « Pro DJ Link
     silencieux » toutes les quinze secondes et conseille au DJ
     d'aller verifier son materiel, alors que le materiel va bien ;

   — l'adresse du reseau local peut changer (bascule wifi, autre
     borne). Le QR affiche a l'entree pointe alors dans le vide, et
     rien ne le signale, ni au DJ ni aux invites ;

   — l'horloge a saute de plusieurs heures : tout ce qui compte du
     temps doit etre relu, pas extrapole.

   Au reveil, on relance donc proprement la source en cours et on
   previent le widget que le lien des invites merite un coup d'oeil.
   ============================================================ */
try {
  powerMonitor.on('resume', () => {
    setTimeout(() => {
      try {
        if (activeApp) {
          const kind = activeApp.nowSource;
          const opts = kind === 'prolink'
      ? { announce: config.prolinkAnnounce, autorise: reseauDeckLibre }
      : config.sourceOpts;
          now.stop();
          stopRekordboxFichiers();
          now.start(kind, opts);
          if (kind === 'prolink') startRekordboxFichiers();
        }
        /* L'adresse a pu changer : on le dit plutot que de laisser un
           QR mort a l'entree de la salle. */
        if (guests && guests.enMarche && guests.enMarche()) {
          send('conseils', [{
            cle: 'reveil-reseau', quand: 'invites',
            titre: 'Verifie le lien des invites',
            texte: 'L\'ordinateur sort de veille. Si le reseau a change, l\'adresse du QR ' +
                   'affiche a l\'entree ne repond plus.',
            marche: ['Ouvre les reglages, section Invites',
                     'Reaffiche le QR : il porte l\'adresse actuelle']
          }]);
        }
      } catch (e) { noterPanne('reveil de veille', e); }
    }, 2500);   /* on laisse le reseau se remettre debout */
  });
} catch (e) { /* powerMonitor n'existe pas partout : ce n'est pas grave */ }

app.on('before-quit', () => {
  app.isQuitting = true;
  try { globalShortcut.unregisterAll(); } catch (e) {}
  watcher.stop(); now.stop(); guests.stop();
  if (libraryWatcher) libraryWatcher.stop();
  if (structCache) structCache.save(true);
  /* L'apprentissage attend jusqu'a quatre secondes avant d'ecrire :
     sans ce vidage, une fermeture rapide perdait les derniers reglages
     appris — ou laissait intact ce qu'on venait d'effacer. */
  try { if (gout) gout.ecrireMaintenant(); } catch (e) {}
  /* Le journal des sets regroupe ses ecritures toutes les quinze
     secondes : sans ce vidage, les derniers morceaux d'une soiree
     partiraient a la poubelle a la fermeture. */
  try { if (setlog) setlog.vider(); } catch (e) {}
  structPool.close();
});
