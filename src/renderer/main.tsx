import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./design/system.css";
import { AppProvider } from "./state/store";
import { installBrowserMock } from "./dev/browserMock";

// Aperçu navigateur UNIQUEMENT en développement : sans le preload Electron,
// window.nova est absent. Un mock neutre permet de prévisualiser l'interface
// (états vides). En Electron, le preload injecte window.nova et ce bloc ne fait
// rien. En build de production, import.meta.env.DEV vaut false : le mock est
// éliminé du bundle (il ne doit JAMAIS être distribué).
if (import.meta.env.DEV) {
  installBrowserMock();
}

async function boot(): Promise<void> {
  const prefs = await window.nova.getPreferences();
  if (!prefs.scanOnStartup) return;
  try {
    await window.nova.startScan({ mode: "full", targets: null });
  } catch {
    /* l'analyse de démarrage est facultative */
  }
}

void boot().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppProvider>
        <App />
      </AppProvider>
    </React.StrictMode>,
  );
});