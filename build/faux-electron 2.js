/* Un faux Electron : juste assez pour que main.js s'execute
   jusqu'au bout de son chargement. On ne teste pas l'interface —
   on teste qu'aucun require ne manque et qu'aucune ligne du
   demarrage ne jette. C'est la panne la plus couteuse : l'app qui
   ne s'ouvre pas du tout chez le testeur. */
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const noop = () => {};
const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain });
const app = Object.assign(new EventEmitter(), {
  getPath: (n) => path.join(os.tmpdir(), 'faux-liaison', n),
  getVersion: () => '0.9.6', getName: () => 'Liaison', setName: noop,
  whenReady: () => new Promise(() => {}),          /* ne resout jamais : on s'arrete au chargement */
  requestSingleInstanceLock: () => true, quit: noop, setLoginItemSettings: noop,
  getLoginItemSettings: () => ({}), setAppUserModelId: noop, isPackaged: false,
  dock: { hide: noop, show: noop }, commandLine: { appendSwitch: noop }
});
class BrowserWindow extends EventEmitter {
  constructor() { super(); this.webContents = new EventEmitter();
    Object.assign(this.webContents, { send: noop, openDevTools: noop, setWindowOpenHandler: noop }); }
  loadFile() {} loadURL() {} show() {} hide() {} focus() {} destroy() {}
  isDestroyed() { return false; } setAlwaysOnTop() {} setBounds() {} getBounds() { return {x:0,y:0,width:380,height:600}; }
  setSize() {} setOpacity() {} setIgnoreMouseEvents() {} isVisible() { return true; }
  static getAllWindows() { return []; }
}
module.exports = {
  app, BrowserWindow,
  ipcMain: Object.assign(new EventEmitter(), {
    handle: (c, f) => { module.exports.__handlers[c] = f; },
    /* les canaux en send() comptent aussi : le glisser-deposer passe par la */
    on: (c, f) => { module.exports.__ecouteurs[c] = f; },
    removeHandler: noop }),
  __handlers: {},
  __ecouteurs: {},
  Menu: { buildFromTemplate: () => ({ popup: noop }), setApplicationMenu: noop },
  Tray: class { constructor() {} setToolTip() {} setContextMenu() {} on() {} destroy() {} },
  nativeImage: { createFromDataURL: () => ({ isEmpty: () => false, resize: () => ({}) }),
                 createFromBuffer: () => ({ isEmpty: () => false, resize: () => ({}) }),
                 createFromPath: (p) => ({ isEmpty: () => !require('fs').existsSync(p),
                                           resize: () => ({ __icone: p }) }),
                 createEmpty: () => ({ isEmpty: () => true, resize: () => ({}) }) },
  dialog: { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }),
            showMessageBox: async () => ({ response: 0 }) },
  shell: { openExternal: noop, showItemInFolder: noop },
  clipboard: { writeText: noop }, screen: { getPrimaryDisplay: () => ({ workArea: { x:0,y:0,width:1920,height:1080 } }),
            getAllDisplays: () => [] },
  globalShortcut: { register: noop, unregisterAll: noop },
  powerSaveBlocker: { start: () => 1, stop: noop },
  session: { defaultSession: { webRequest: { onBeforeRequest: noop } } },
  systemPreferences: chain
};
