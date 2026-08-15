import { useState } from "react";
import { formatBytes } from "../../shared/types";
import { useApp } from "../state/store";
import { Modal, ProgressBar } from "./ui";

export function ConfirmDelete({
  fileCount,
  bytes,
  onConfirm,
  onClose,
  permanentReason,
}: {
  fileCount: number;
  bytes: number;
  onConfirm: (mode: "recycle" | "permanent") => Promise<void>;
  onClose: () => void;
  permanentReason?: string;
}) {
  const { prefs } = useApp();
  const [mode, setMode] = useState<"recycle" | "permanent">(prefs?.recycleByDefault === false ? "permanent" : "recycle");
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState(false);

  const confirm = async () => {
    setBusy(true);
    await onConfirm(mode);
    setBusy(false);
  };

  return (
    <Modal title="Vous êtes sur le point de supprimer" onClose={onClose}>
      <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
        <div className="stat-card" style={{ flex: 1, animation: "none" }}>
          <div className="stat-label">Fichiers</div>
          <div className="stat-value" style={{ fontSize: 26 }}>{fileCount.toLocaleString("fr-FR")}</div>
        </div>
        <div className="stat-card" style={{ flex: 1, animation: "none" }}>
          <div className="stat-label">Espace</div>
          <div className="stat-value accent" style={{ fontSize: 26 }}>{formatBytes(bytes)}</div>
        </div>
      </div>

      <div className="modal-note">
        <strong>Corbeille (recommandé)</strong> — les éléments restent récupérables depuis la corbeille Windows.
        <br />
        <strong>Suppression définitive</strong> — irréversible, l'espace est libéré immédiatement.
      </div>

      <div className="segmented" style={{ marginBottom: 16 }}>
        <button className={mode === "recycle" ? "active" : ""} onClick={() => setMode("recycle")}>🗑 Corbeille</button>
        <button className={mode === "permanent" ? "active" : ""} onClick={() => setMode("permanent")}>⚠️ Définitive</button>
      </div>

      {mode === "permanent" && prefs?.confirmPermanentDelete !== false && (
        <div className="insight warning" style={{ marginBottom: 8 }}>
          <span className="insight-ico">⚠️</span>
          <div>
            <div className="insight-title">Suppression irréversible</div>
            <p className="insight-msg">
              {permanentReason ?? "Cette action est définitive et ne peut pas être annulée."}
            </p>
            {!typed && (
              <label className="muted small" style={{ display: "block", marginTop: 10 }}>
                Tapez <strong>SUPPRIMER</strong> pour confirmer
                <input className="input mt-2" placeholder="SUPPRIMER" onChange={(e) => setTyped(e.target.value === "SUPPRIMER")} />
              </label>
            )}
            {typed && <div className="small good mt-2" style={{ color: "var(--good)" }}>✓ Confirmation saisie</div>}
          </div>
        </div>
      )}

      {mode === "recycle" && (
        <div className="insight info">
          <span className="insight-ico">🗑</span>
          <div>
            <div className="insight-title">Récupérable</div>
            <p className="insight-msg">
              Les éléments supprimés seront déplacés vers la corbeille Windows. Vous pourrez les restaurer si besoin.
            </p>
          </div>
        </div>
      )}

      {busy && <ProgressBar value={50} indeterminate />}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Annuler</button>
        <button
          className={`btn ${mode === "permanent" ? "btn-danger" : "btn-primary"}`}
          onClick={() => void confirm()}
          disabled={busy || (mode === "permanent" && (prefs?.confirmPermanentDelete !== false) && !typed)}
        >
          {mode === "permanent" ? "Supprimer définitivement" : "Envoyer à la corbeille"}
        </button>
      </div>
    </Modal>
  );
}
