import { useEffect, useState } from "react";
import type { GameInfo } from "../../shared/types";
import { formatBytes } from "../../shared/types";
import { EmptyState, LoadingBar } from "../components/ui";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { useApp } from "../state/store";

function libraryBadge(lib: GameInfo["library"]) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    Steam: { bg: "rgba(27,147,214,0.2)", color: "#6cb5e8", label: "Steam" },
    Epic: { bg: "rgba(255,255,255,0.12)", color: "#c9cfd8", label: "Epic" },
    "Battle.net": { bg: "rgba(0,174,240,0.2)", color: "#5cc4f4", label: "Battle.net" },
    GOG: { bg: "rgba(138,255,0,0.14)", color: "#a6f55c", label: "GOG" },
    Riot: { bg: "rgba(209,54,57,0.22)", color: "#ff8f8f", label: "Riot" },
    Xbox: { bg: "rgba(16,124,16,0.25)", color: "#6fd96f", label: "Xbox" },
    Other: { bg: "rgba(148,163,184,0.15)", color: "#b6c2d4", label: "Autre" },
  };
  const b = map[lib] ?? map.Other;
  return <span className="tag" style={{ background: b.bg, color: b.color, borderColor: b.bg }}>🎮 {b.label}</span>;
}

export function Games() {
  const { pushToast } = useApp();
  const [games, setGames] = useState<GameInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<GameInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setGames(null);
    void window.nova
      .getGames()
      .then(setGames)
      .catch((e) => setError((e as Error).message));
  };

  useEffect(() => {
    load();
  }, []);

  const confirmDelete = async (mode: "recycle" | "permanent") => {
    if (!toDelete) return;
    setBusy(true);
    try {
      const res = await window.nova.uninstallGame(toDelete.path, mode);
      pushToast({
        kind: res.ok ? "success" : "warning",
        title: res.ok ? (mode === "recycle" ? "Jeu envoyé à la corbeille" : "Jeu supprimé") : "Suppression impossible",
        message: res.message,
      });
      if (res.ok) {
        setToDelete(null);
        load();
      }
    } catch (e) {
      pushToast({ kind: "error", title: "Suppression impossible", message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (error) return <EmptyState icon="♟" title="Détection impossible" sub={error} />;
  if (!games) {
    return (
      <div className="loading-block-centered" style={{ maxWidth: 560, margin: "0 auto", paddingTop: 64 }}>
        <LoadingBar label="Recherche des bibliothèques de jeux…" />
      </div>
    );
  }

  const total = games.reduce((a, g) => a + g.size, 0);
  const libs = Array.from(new Set(games.map((g) => g.library)));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Jeux</h1>
          <p className="page-sub">
            Bibliothèques Steam, Epic, Battle.net, Riot Games et plus. La désinstallation déplace le dossier du jeu vers la
            corbeille (récupérable) ou le supprime définitivement — toujours après confirmation. Les sauvegardes
            situées hors du dossier (documents, AppData) ne sont pas touchées.
          </p>
        </div>
      </div>

      <div className="row mb-4" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className="tag">🎮 {games.length} jeux détectés</span>
        <span className="tag">{formatBytes(total)} au total</span>
        {libs.map((l) => libraryBadge(l))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {games.map((g) => (
          <div className="card" key={g.path} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 18 }}>
            <div className="row-between">
              <span style={{ fontWeight: 700 }}>{g.name}</span>
              {libraryBadge(g.library)}
            </div>
            <div className="stat-value" style={{ fontSize: 24 }}>{formatBytes(g.size)}</div>
            <div className="row-between mt-2">
              <span className="path-cell" style={{ maxWidth: "55%" }} title={g.path}>{g.path}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => void window.nova.openInFolder(g.path)}>⌕ Dossier</button>
            </div>
            <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button className="btn btn-sm btn-danger" onClick={() => setToDelete(g)}>🗑 Désinstaller</button>
            </div>
          </div>
        ))}
      </div>

      {games.length === 0 && (
        <EmptyState icon="♟" title="Aucun jeu détecté" sub="Installez Steam, Epic Games Launcher, Battle.net ou Riot Games pour les voir apparaître ici." />
      )}

      {toDelete && (
        <ConfirmDelete
          fileCount={1}
          bytes={toDelete.size}
          onClose={() => (busy ? undefined : setToDelete(null))}
          onConfirm={(mode) => confirmDelete(mode)}
          permanentReason="Le dossier du jeu sera supprimé définitivement. Vos sauvegardes et paramètres situés hors de ce dossier (Documents, AppData) ne sont pas concernés."
        />
      )}
    </div>
  );
}
