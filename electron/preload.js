const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (payload) => ipcRenderer.invoke(channel, payload);
const listen = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld(
  "mediaAPI",
  Object.freeze({
    selectFiles: invoke("dialog:selectFiles"),
    chooseOutputDirectory: invoke("settings:chooseOutputDir"),
    getSettings: invoke("settings:get"),
    setSettings: invoke("settings:set"),
    detectHardware: invoke("media:detectHardware"),
    enqueue: invoke("jobs:enqueue"),
    cancelJob: invoke("jobs:cancel"),
    retryJob: invoke("jobs:retry"),
    listJobs: invoke("jobs:list"),
    getHistory: invoke("history:list"),
    deleteHistory: invoke("history:delete"),
    clearHistory: invoke("history:clear"),
    openPath: invoke("shell:openPath"),
    showInFolder: invoke("shell:showInFolder"),
    api: (method, path, body) =>
      ipcRenderer.invoke("api:request", { method, path, body }),
    authBoot: invoke("auth:boot"),
    authState: invoke("auth:state"),
    authRefresh: invoke("auth:refresh"),
    logout: invoke("auth:logout"),
    openCheckout: invoke("shell:openCheckout"),
    appInfo: invoke("app:info"),
    prepareScreenshot: invoke("bug:prepareScreenshot"),
    recentLog: invoke("log:recent"),
    thumbnail: invoke("vault:thumbnail"),
    updateCheck: invoke("update:check"),
    updateDownload: invoke("update:download"),
    updateInstall: invoke("update:install"),
    onJobUpdate: listen("jobs:update"),
  }),
);
