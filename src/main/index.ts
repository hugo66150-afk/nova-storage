import { app, BrowserWindow, nativeTheme, ipcMain } from "electron";
import * as path from "node:path";
import * as url from "node:url";
import { registerIpc } from "./ipc.js";
import { getDb, closeDb } from "./data/db.js";
import { logger } from "./infra/logger.js";
import { guardianService } from "./services/guardian.js";
import { licenseService } from "./services/licenseService.js";
import { setupAutoUpdater } from "./services/updater.js";
import { getScheduledRules, shouldRunNow, runRuleEngine, getLatestScanId } from "./services/automation.js";
import { autocleanService } from "./services/autoclean.js";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
nativeTheme.themeSource = "dark";

let mainWindow: BrowserWindow | null = null;

const isDev = !!process.env.VITE_DEV_SERVER_URL;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: "#0a0a12",
    title: "Nova Storage",
    icon: path.join(app.getAppPath(), "assets", "branding", "nova.png"),
    webPreferences: {
      preload: path.join(app.getAppPath(), "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  const send = (channel: string, payload?: unknown): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  };

  mainWindow.on("maximize", () => send("win:maximized", true));
  mainWindow.on("unmaximize", () => send("win:maximized", false));
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    let allowed = false;
    if (isDev && process.env.VITE_DEV_SERVER_URL) {
      // Comparaison stricte origine-à-origine (protocole + hôte + port) :
      // un préfixe similaire (ex. 127.0.0.1:5173.evil.com) ne doit jamais passer.
      try {
        const target = new URL(targetUrl);
        const dev = new URL(process.env.VITE_DEV_SERVER_URL);
        allowed = target.protocol === dev.protocol && target.host === dev.host;
      } catch {
        allowed = false;
      }
    } else {
      allowed = targetUrl.startsWith("file://");
    }
    if (!allowed) event.preventDefault();
  });
  // Aucun webview ne doit être autorisé : défense en profondeur.
  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window:close", () => mainWindow?.close());

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    logger.init();
    logger.info("Démarrage de Nova Storage");
    if (process.platform === "win32") {
      app.setAppUserModelId("com.novastorage.app");
    }
    getDb();
    registerIpc();
    // Revalidation périodique de la licence (asynchrone, non bloquante) :
    // n'exécute aucun réseau si aucune licence n'est activée.
    void licenseService.revalidateIfDue();
    createWindow();
    // Auto-update (packagé uniquement) : vérification différée, téléchargement
    // en arrière-plan, installation silencieuse à la fermeture de l'app.
    setupAutoUpdater();

    guardianService.attach((channel, payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(channel, payload);
    });
    if (guardianService.enabled) {
      guardianService.start();
      void guardianService.check(true);
    }

    // Automatisation : planificateur de règles
    let automationTimer: NodeJS.Timeout | null = null;
    function checkAutomation(): void {
      // La maintenance planifiée est une fonctionnalité Nova Pro : sans droit,
      // les règles existantes restent sauvegardées mais ne s'exécutent pas.
      if (!licenseService.can("scheduledMaintenance")) return;
      const rules = getScheduledRules();
      for (const rule of rules) {
        if (shouldRunNow(rule)) {
          const scanId = getLatestScanId();
          if (scanId) {
            logger.info(`Exécution planifiée de la règle "${rule.name}"`);
            runRuleEngine(rule, scanId, false).catch((err) => {
              logger.warn(`Échec exécution planifiée "${rule.name}" : ${err instanceof Error ? err.message : String(err)}`);
            });
          }
        }
      }
    }
    automationTimer = setInterval(checkAutomation, 60000);
    automationTimer.unref?.();
    checkAutomation();
    // Nova AutoClean (Nova Pro) : même boucle, déclencheurs propres (daily /
    // weekly / startup / seuil disque). Gate scheduledMaintenance appliquée
    // dans le service — sans droit, rien ne s'exécute (config conservée).
    const autocleanTimer = setInterval(() => void autocleanService.runAutoCleanIfDue(), 60000);
    autocleanTimer.unref?.();
    void autocleanService.runAutoCleanIfDue();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    // Si le Gardien est actif, on continue en arrière-plan (systray).
    if (guardianService.enabled) return;
    app.quit();
  });

  app.on("before-quit", () => {
    try {
      closeDb();
    } catch {
      /* silencieux */
    }
  });
}