'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch, fn) => ipcRenderer.on(ch, (e, payload) => fn(payload));

contextBridge.exposeInMainWorld('liaison', {
  getConfig: () => invoke('config:get'),
  pack: (country, event) => invoke('locales:pack', country, event),
  setConfig: patch => invoke('config:set', patch),
  pickLibrary: mode => invoke('library:pick', mode),
  suggest: () => invoke('suggest'),
  rescue: () => invoke('rescue'),
  clientGet: () => invoke('client:get'),
  clientImport: opt => invoke('client:import', opt),
  clientClear: side => invoke('client:clear', side),
  clientShopping: () => invoke('client:shopping'),
  clientRemove: opt => invoke('client:remove', opt),
  structure: id => invoke('structure:get', id),
  analysisState: () => invoke('analysis:state'),
  /* ce que Liaison a appris du DJ */
  goutEtat: () => invoke('gout:etat'),
  goutOublier: () => invoke('gout:oublier'),
  /* ce que le DJ a reellement fait avec l'app, pour lui parler de lui */
  bilan: () => invoke('stats:bilan'),
  /* les tarifs du jour, jamais ecrits en dur dans l'interface */
  tarifs: () => invoke('tarifs:get'),
  /* les mises a jour : on previent, on ne remplace jamais tout seul */
  majEtat: () => invoke('maj:etat'),
  majOuvrir: () => invoke('maj:ouvrir'),
  majIgnorer: v => invoke('maj:ignorer', v),

  /* les soirees preparees a l'avance */
  soireesListe: () => invoke('soirees:liste'),
  soireeCreer: p => invoke('soirees:creer', p),
  soireeModifier: (id, patch) => invoke('soirees:modifier', { id, patch }),
  soireeDupliquer: (id, nom) => invoke('soirees:dupliquer', { id, nom }),
  soireeSupprimer: id => invoke('soirees:supprimer', id),
  soireeActiver: id => invoke('soirees:activer', id),
  soireeDesactiver: () => invoke('soirees:desactiver'),
  /* sante de la bibliotheque */
  healthScan: opt => invoke('health:scan', opt),
  healthReveal: id => invoke('health:reveal', id),
  /* mode preparation */
  prepareBuild: opt => invoke('prepare:build', opt),
  prepareExport: opt => invoke('prepare:export', opt),
  nowPlaying: () => invoke('now:get'),
  loadTrack: id => invoke('track:load', id),
  searchTrack: q => invoke('track:search', q),
  startSession: () => invoke('session:start'),
  requests: () => invoke('session:requests'),
  openExternal: url => invoke('share:open', url),
  copy: text => invoke('share:copy', text),
  saveQR: dataUrl => invoke('qr:save', dataUrl),
  listSets: () => invoke('sets:list'),
  replaySet: opts => invoke('sets:replay', opts),
  /* la tracklist */
  tracklist: id => invoke('sets:tracklist', id),
  copySet: id => invoke('sets:copy', id),
  /* le debrief de fin de soiree : des mesures, pas des conseils */
  setDebrief: id => invoke('sets:debrief', id),
  exportSet: opt => invoke('sets:export', opt),
  /* les filtres de cabine */
  filters: () => invoke('filters:get'),
  setFilters: patch => invoke('filters:set', patch),
  crates: () => invoke('filters:crates'),
  /* l'atterrissage de fin de set */
  landingPlan: minutes => invoke('landing:plan', minutes),
  landingGet: () => invoke('landing:get'),
  landingClear: () => invoke('landing:clear'),
  openLicence: view => invoke('licence:open', view),
  closeLicence: () => invoke('licence:close'),
  iconDataUrl: () => invoke('icon:data'),
  licenseStatus: () => invoke('license:status'),
  licenseActivate: key => invoke('license:activate', key),
  licenseRefresh: () => invoke('license:refresh'),
  licenseRelease: () => invoke('license:release'),
  licenseBuy: plan => invoke('license:buy', plan),
  autoImport: () => invoke('library:auto'),
  rescanLibrary: opt => invoke('library:rescan', opt),
  scanInfo: () => invoke('library:scanInfo'),
  librarySources: () => invoke('library:sources'),
  runningApps: () => invoke('apps:running'),
  openSettings: () => invoke('widget:settings'),
  hideWidget: () => invoke('widget:close'),
  setHeight: h => invoke('widget:height', h),
  /* le glisser-deposer vers le deck : send(), pas invoke() — startDrag
     doit partir pendant l'evenement dragstart et ne rend rien */
  dragTrack: id => ipcRenderer.send('drag:track', id),
  dragPossible: id => invoke('drag:possible', id),
  on: on
});
