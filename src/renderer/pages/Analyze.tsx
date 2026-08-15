import { useEffect, useState } from "react";
import { useApp } from "../state/store";
import type { ScanSettings, ScanStatus } from "../../shared/types";
import { formatBytes, formatDuration, formatNumber } from "../../shared/types";
import { ProgressBar, Segmented } from "../components/ui";

type Mode = "quick" | "full" | "custom";

export function Analyze() {
  const { scanState, setPage, pushToast } = useApp();
  const [mode, setModeState] = useState<Mode>("full");
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [selectedDrives, setSelectedDrives] = useState<string[]>(["C:\\"]);
  const [starting, setStarting] = useState(false);
  const [drives, setDrives] = useState<Array<{ name: string; label: string; total: number; free: number; used: number }>>([]);

  useEffect(() => {
    void window.nova.getDrives().then(setDrives);
  }, []);

  const { active, progress, lastResult } = scanState;

  const start = async () => {
    let settings: ScanSettings;
    if (mode === "custom") {
      if (customFolders.length === 0 && selectedDrives.length === 0) {
        pushToast({ kind: "warning", title: "Sélection requise", message: "Choisissez un disque ou un dossier." });
        return;
      }
      const paths = [...selectedDrives, ...customFolders];
      settings = { mode: "custom", targets: { kind: "multi", paths } };
    } else {
      settings = { mode, targets: null };
    }
    setStarting(true);
    try {
      await window.nova.startScan(settings);
      pushToast({ kind: "info", title: "Analyse lancée", message: "Le scan ne bloque pas l'interface." });
    } catch (e) {
      pushToast({ kind: "error", title: "Impossible de lancer l'analyse", message: (e as Error).message });
    } finally {
      setStarting(false);
    }
  };

  const toggleDrive = (name: string) => {
    setSelectedDrives((prev) => (prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]));
  };

  /* ----------------- Etat : scan en cours ----------------- */
  if (active && progress) {
    const status: ScanStatus = progress.status;
    const paused = status === "paused";
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">Analyse en cours</h1>
            <p className="page-sub">{progress.target}</p>
          </div>
        </div>

        <div className="card hero" style={{ maxWidth: 760 }}>
          <div className="row-between mb-4">
            <div className="stat-value accent" style={{ fontSize: 42 }}>
              {progress.percent > 0 ? `${progress.percent} %` : "…"}
            </div>
            <div className="tag pulse">{paused ? "⏸ En pause" : "● Analyse active"}</div>
          </div>
          <ProgressBar
            value={progress.percent || 16}
            indeterminate={progress.percent === 0}
            tone={paused ? "warn" : "accent"}
            height={14}
          />
          <div className="mono xs faint mt-2" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {progress.currentPath || progress.target}
          </div>

          <div className="grid-4 mt-5" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
            <StatCell label="Fichiers analysés" value={formatNumber(progress.filesAnalyzed)} />
            <StatCell label="Taille analysée" value={formatBytes(progress.bytesAnalyzed)} />
            <StatCell label="Temps écoulé" value={formatDuration(progress.elapsedMs)} />
            <StatCell label="Estimation restante" value={progress.etaMs ? formatDuration(progress.etaMs) : "…"} />
          </div>

          <div className="row mt-5" style={{ justifyContent: "flex-end", gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => void window.nova.cancelScan()}>Annuler</button>
            {paused ? (
              <button className="btn btn-primary" onClick={() => void window.nova.resumeScan()}>▶ Reprendre</button>
            ) : (
              <button className="btn" onClick={() => void window.nova.pauseScan()}>⏸ Mettre en pause</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ----------------- Etat : config ----------------- */
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Analyser</h1>
          <p className="page-sub">
            Nova analyse vos disques en arrière-plan. Choisissez un niveau d'analyse : une vue rapide, une
            cartographie complète, ou une sélection précise.
          </p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 800 }}>
        <div className="row-between mb-4" style={{ flexWrap: "wrap", gap: 12 }}>
          <Segmented<Mode>
            value={mode}
            onChange={setModeState}
            options={[
              { value: "quick", label: "⚡ Analyse rapide" },
              { value: "full", label: "🔍 Analyse complète" },
              { value: "custom", label: "🎯 Personnalisée" },
            ]}
          />
        </div>

        <ModeInfo mode={mode} />

        {mode === "custom" && (
          <div className="mt-4">
            <div className="stat-label mb-4">Disques</div>
            <div className="pill-row">
              {drives.map((d) => (
                <button
                  key={d.name}
                  className={`tag ${selectedDrives.includes(d.name) ? "active" : ""}`}
                  onClick={() => toggleDrive(d.name)}
                  style={selectedDrives.includes(d.name) ? { background: "rgba(139,92,246,0.2)", borderColor: "var(--accent)", color: "#fff" } : { cursor: "pointer" }}
                >
                  {d.name} {formatBytes(d.used)} utilisés
                </button>
              ))}
            </div>
            <div className="stat-label mt-4 mb-2">Dossiers</div>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-sm" onClick={async () => {
                const p = await window.nova.pickFolders();
                if (p) setCustomFolders((prev) => Array.from(new Set([...prev, ...p])));
              }}>
                + Ajouter des dossiers
              </button>
              <button className="btn btn-sm btn-ghost" onClick={async () => {
                const p = await window.nova.pickFolder();
                if (p) setCustomFolders((prev) => Array.from(new Set([...prev, p])));
              }}>
                + Un dossier
              </button>
            </div>
            <div className="table-wrap mt-4">
              {customFolders.length === 0 && <div className="muted small" style={{ padding: 16 }}>Aucun dossier sélectionné. Les disques cochés suffisent.</div>}
              {customFolders.map((p) => (
                <div key={p} className="file-row">
                  <span className="file-name mono">{p}</span>
                  <button className="icon-btn danger" onClick={() => setCustomFolders((prev) => prev.filter((x) => x !== p))}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="row mt-5" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => setPage("dashboard")}>Annuler</button>
          <button className="btn btn-primary" disabled={starting} onClick={() => void start()}>
            {starting ? <><span className="spinner" /> Lancement…</> : "▶ Lancer l'analyse"}
          </button>
        </div>
      </div>

      {lastResult && lastResult.status !== "cancelled" && (
        <div className="card mt-5" style={{ maxWidth: 800 }}>
          <h3>Dernière analyse</h3>
          <div className="row mt-4" style={{ gap: 24, flexWrap: "wrap" }}>
            <div>
              <div className="stat-label">Taille analysée</div>
              <div className="stat-value accent" style={{ fontSize: 26 }}>{formatBytes(lastResult.totalBytes)}</div>
            </div>
            <div>
              <div className="stat-label">Fichiers</div>
              <div className="stat-value" style={{ fontSize: 26 }}>{formatNumber(lastResult.totalFiles)}</div>
            </div>
            <div>
              <div className="stat-label">Récupérable</div>
              <div className="stat-value good" style={{ fontSize: 26 }}>{formatBytes(lastResult.recoverable.totalBytes)}</div>
            </div>
            <div style={{ display: "flex", gap: 10, marginLeft: "auto", alignItems: "center" }}>
              <button className="btn" onClick={() => setPage("explorer")}>❏ Explorer</button>
              <button className="btn btn-primary" onClick={() => setPage("cleanup")}>✦ Nettoyer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 22 }}>{value}</div>
    </div>
  );
}

function ModeInfo({ mode }: { mode: Mode }) {
  if (mode === "quick") {
    return (
      <div className="insight info">
        <span className="insight-ico">⚡</span>
        <div>
          <div className="insight-title">Analyse rapide</div>
          <p className="insight-msg">
            Passe rapidement les principales zones de stockage pour obtenir une vision générale des catégories
            et des grosses masses. Idéale pour un aperçu en moins d'une minute.
          </p>
        </div>
      </div>
    );
  }
  if (mode === "full") {
    return (
      <div className="insight info">
        <span className="insight-ico">🔍</span>
        <div>
          <div className="insight-title">Analyse complète</div>
          <p className="insight-msg">
            Parcourt récursivement tous les fichiers accessibles : catégories, gros fichiers, fichiers anciens,
            téléchargements, caches et temporaires. Le scan est parallélisé et n'interrompt jamais l'interface.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="insight info">
      <span className="insight-ico">🎯</span>
      <div>
        <div className="insight-title">Analyse personnalisée</div>
        <p className="insight-msg">
          Sélectionnez un ou plusieurs disques, ou ajoutez des dossiers précis pour ne scanner que ce qui vous
          intéresse.
        </p>
      </div>
    </div>
  );
}