import { app } from "electron";
// electron-updater est un module CommonJS : sous le chargeur ESM de Node,
// l'import nommé `{ autoUpdater }` échoue au runtime (exports non détectés
// statiquement). Le motif « import par défaut + déstructuration » est le seul
// fiable — c'est aussi ce que recommande Node dans son message d'erreur.
import electronUpdater from "electron-updater";
import { logger } from "../infra/logger.js";

const { autoUpdater } = electronUpdater;

let initialized = false;

/**
 * Met à jour l'application automatiquement (mode packagé uniquement).
 *
 * - La config de publication (fournisseur `generic` → dossier /downloads du
 *   site Nova Storage) est embarquée par electron-builder dans
 *   `app-update.yml` : rien à coder ici. Si le domaine public change, adapter
 *   `build.publish` dans package.json puis reconstruire.
 * - En dev, aucune vérification (electron-updater refuse hors packaging).
 * - Téléchargement en arrière-plan, installation silencieuse à la fermeture
 *   (installateur NSIS par utilisateur → pas d'élévation nécessaire).
 * - Toute erreur (hors ligne, serveur indisponible…) est non bloquante.
 */
export function setupAutoUpdater(): void {
  if (!app.isPackaged || initialized) return;
  initialized = true;

  // Surcharge utile pour tester contre un serveur local/staging : pointe la
  // vérification ailleurs sans toucher à app-update.yml (dev/CI uniquement).
  const feedUrl = process.env.NOVA_UPDATE_URL;
  if (feedUrl) {
    autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
    logger.info(`Mise à jour : URL forcée par NOVA_UPDATE_URL (${feedUrl})`);
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    logger.info("Mise à jour : vérification des mises à jour…");
  });
  autoUpdater.on("update-available", (info) => {
    logger.info(`Mise à jour disponible : v${info.version} (téléchargement en arrière-plan)`);
  });
  autoUpdater.on("update-not-available", (info) => {
    logger.info(`Mise à jour : déjà à jour (v${info.version})`);
  });
  autoUpdater.on("download-progress", (progress) => {
    logger.debug(`Mise à jour : téléchargement ${Math.round(progress.percent)} %`);
  });
  autoUpdater.on("update-downloaded", (info) => {
    logger.info(`Mise à jour v${info.version} téléchargée — installation à la fermeture.`);
  });
  autoUpdater.on("error", (err) => {
    // Hors ligne, serveur indisponible, pas de mise à jour : jamais bloquant.
    logger.warn(`Mise à jour : ${err instanceof Error ? err.message : String(err)}`);
  });

  // Vérification différée : le démarrage de l'app ne doit pas en dépendre.
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((err) => {
      logger.warn(`Mise à jour : vérification impossible (${err instanceof Error ? err.message : String(err)})`);
    });
  }, 15_000);
}
