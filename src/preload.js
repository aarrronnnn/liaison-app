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
  openLicence: view => invoke('licence:open', view),
  closeLicence: () => invoke('licence:close'),
  iconDataUrl: () => invoke('icon:data'),
  licenseStatus: () => invoke('license:status'),
  licenseActivate: key => invoke('license:activate', key),
  licenseRefresh: () => invoke('license:refresh'),
  licenseRelease: () => invoke('license:release'),
  licenseBuy: plan => invoke('license:buy', plan),
  autoImport: () => invoke('library:auto'),
  librarySources: () => invoke('library:sources'),
  runningApps: () => invoke('apps:running'),
  openSettings: () => invoke('widget:settings'),
  hideWidget: () => invoke('widget:close'),
  setHeight: h => invoke('widget:height', h),
  on: on
});
