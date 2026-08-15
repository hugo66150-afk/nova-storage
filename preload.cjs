const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getDrives: () => ipcRenderer.invoke("drives:get"),
  getOverview: () => ipcRenderer.invoke("overview:get"),
  startScan: (settings) => ipcRenderer.invoke("scan:start", settings),
  pauseScan: () => ipcRenderer.invoke("scan:pause"),
  resumeScan: () => ipcRenderer.invoke("scan:resume"),
  cancelScan: () => ipcRenderer.invoke("scan:cancel"),
  getScanResult: (scanId) => ipcRenderer.invoke("scan:getResult", scanId),
  getLastScanResult: () => ipcRenderer.invoke("scan:getLast"),
  getDirChildren: (_scanId, _path) => ipcRenderer.invoke("explorer:getDirChildren", _scanId, _path),
  getLargeFiles: (scanId, minSize, offset, limit) => ipcRenderer.invoke("files:large", scanId, minSize, offset, limit),
  getOldFiles: (scanId, days, offset, limit) => ipcRenderer.invoke("files:old", scanId, days, offset, limit),
  getByCategory: (scanId, category, offset, limit) => ipcRenderer.invoke("files:category", scanId, category, offset, limit),
  getDownloads: (scanId, offset, limit) => ipcRenderer.invoke("files:downloads", scanId, offset, limit),
  getRecommendationDetail: (scanId, kind, offset, limit) => ipcRenderer.invoke("recommendation:detail", scanId, kind, offset, limit),
  getDuplicates: (scanId) => ipcRenderer.invoke("duplicates:get", scanId),
  getApps: () => ipcRenderer.invoke("apps:get"),
  getGames: () => ipcRenderer.invoke("games:get"),
  uninstallGame: (gamePath, mode) => ipcRenderer.invoke("games:uninstall", gamePath, mode),
  cleanup: (request) => ipcRenderer.invoke("cleanup:run", request),
  getRecycleBinInfo: () => ipcRenderer.invoke("recyclebin:info"),
  emptyRecycleBin: () => ipcRenderer.invoke("recyclebin:empty"),
  getHistory: () => ipcRenderer.invoke("history:get"),
  getTrend: () => ipcRenderer.invoke("trend:get"),
  openPath: (p) => ipcRenderer.invoke("fs:open", p),
  openInFolder: (p) => ipcRenderer.invoke("fs:show", p),
  copyPath: (p) => ipcRenderer.invoke("fs:copy", p),
  pickFolder: () => ipcRenderer.invoke("fs:pickFolder"),
  pickFolders: () => ipcRenderer.invoke("fs:pickFolders"),
  getExclusions: () => ipcRenderer.invoke("exclusions:get"),
  addExclusion: (item) => ipcRenderer.invoke("exclusions:add", item),
  removeExclusion: (id) => ipcRenderer.invoke("exclusions:remove", id),
  refreshApps: () => ipcRenderer.invoke("apps:refresh"),
  preAnalyzeApp: (app) => ipcRenderer.invoke("uninstaller:preAnalyze", app),
  runUninstaller: (sessionId) => ipcRenderer.invoke("uninstaller:run", sessionId),
  getRemains: (sessionId) => ipcRenderer.invoke("uninstaller:remains", sessionId),
  cleanRemains: (sessionId, ids) => ipcRenderer.invoke("uninstaller:cleanRemains", sessionId, ids),
  restoreQuarantine: (sessionId) => ipcRenderer.invoke("uninstaller:restore", sessionId),
  onUninstallProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on("uninstall:progress", listener);
    return () => ipcRenderer.removeListener("uninstall:progress", listener);
  },
  getPreferences: () => ipcRenderer.invoke("prefs:get"),
  savePreferences: (prefs) => ipcRenderer.invoke("prefs:save", prefs),
  getVersion: () => ipcRenderer.invoke("app:version"),
  getLicenseInfo: () => ipcRenderer.invoke("license:getInfo"),
  startTrial: () => ipcRenderer.invoke("license:startTrial"),
  activateLicense: (licenseKey) => ipcRenderer.invoke("license:activate", licenseKey),
  restoreLicense: () => ipcRenderer.invoke("license:restore"),
  openCheckout: () => ipcRenderer.invoke("license:openCheckout"),
  getCoachReport: () => ipcRenderer.invoke("coach:get"),
  getGuardianReport: () => ipcRenderer.invoke("guardian:get"),
  runGuardianCheck: () => ipcRenderer.invoke("guardian:check"),
  onGuardianEvent: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on("guardian:event", listener);
    return () => ipcRenderer.removeListener("guardian:event", listener);
  },
  onGuardianNavigate: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on("guardian:navigate", listener);
    return () => ipcRenderer.removeListener("guardian:navigate", listener);
  },
  // automation
  getRules: () => ipcRenderer.invoke("automation:getRules"),
  saveRule: (rule) => ipcRenderer.invoke("automation:saveRule", rule),
  updateRule: (rule) => ipcRenderer.invoke("automation:updateRule", rule),
  deleteRule: (id) => ipcRenderer.invoke("automation:deleteRule", id),
  runRule: (ruleId, dryRun) => ipcRenderer.invoke("automation:runRule", ruleId, dryRun),
  getExecutions: (ruleId, limit) => ipcRenderer.invoke("automation:getExecutions", ruleId, limit),
  dryRunPreview: (rule) => ipcRenderer.invoke("automation:dryRunPreview", rule),
  // autoclean (Nova Pro)
  getAutoCleanState: () => ipcRenderer.invoke("autoclean:get"),
  saveAutoCleanConfig: (config) => ipcRenderer.invoke("autoclean:save", config),
  runAutoClean: (dryRun) => ipcRenderer.invoke("autoclean:run", dryRun),
  minimize: () => {
    ipcRenderer.send("window:minimize");
  },
  maximize: () => {
    ipcRenderer.send("window:maximize");
  },
  close: () => {
    ipcRenderer.send("window:close");
  },
  isMaximized: (cb) => {
    const listener = (_e, v) => cb(v);
    ipcRenderer.on("win:maximized", listener);
    return () => ipcRenderer.removeListener("win:maximized", listener);
  },
  onScanProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on("scan:progress", listener);
    return () => ipcRenderer.removeListener("scan:progress", listener);
  },
  onScanFinished: (cb) => {
    const listener = (_e, r) => cb(r);
    ipcRenderer.on("scan:finished", listener);
    return () => ipcRenderer.removeListener("scan:finished", listener);
  },
  onScanError: (cb) => {
    const listener = (_e, r) => cb(r);
    ipcRenderer.on("scan:error", listener);
    return () => ipcRenderer.removeListener("scan:error", listener);
  },
  onCleanupProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on("cleanup:progress", listener);
    return () => ipcRenderer.removeListener("cleanup:progress", listener);
  },
};

contextBridge.exposeInMainWorld("nova", api);