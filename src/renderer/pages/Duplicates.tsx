import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store";
import type { DuplicateGroup } from "../../shared/types";
import { formatBytes } from "../../shared/types";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { EmptyState, LoadingBar } from "../components/ui";

export function Duplicates() {
  const { scanState, setPage, pushToast } = useApp();
  const scanId = scanState.lastResult?.scanId;
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState<Map<string, Set<string>>>(new Map());
  const [confirm, setConfirm] = useState<{ files: { path: string; size: number }[]; bytes: number } | null>(null);

  useEffect(() => {
    if (!scanId) {
      setBusy(false);
      return;
    }
    setBusy(true);
    void window.nova
      .getDuplicates(scanId)
      .then((g) => {
        setGroups(g);
        setSelected(new Map(g.map((grp) => [grp.id, new Set(grp.files.map((f) => f.path))])));
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  const totalWaste = useMemo(() => (groups ?? []).reduce((a, g) => a + g.totalBytes, 0), [groups]);

  if (!scanId) {
    return (
      <EmptyState icon="≣" title="Analysez d'abord votre disque" sub="Nova compare les fichiers volumineux par contenu (hash) pour trouver les vrais doublons." action={<button className="btn btn-primary" onClick={() => setPage("analyze")}>Analyser</button>} />
    );
  }

  const keepOne = (g: DuplicateGroup) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const filePaths = g.files.map((f) => f.path);
      next.set(g.id, new Set(filePaths));
      return next;
    });
  };

  const keepOldest = (g: DuplicateGroup) => {
    const oldest = [...g.files].sort((a, b) => a.modified - b.modified)[0];
    setSelected((prev) => {
      const next = new Map(prev);
      const keep = new Set(g.files.filter((f) => f.path !== oldest.path).map((f) => f.path));
      next.set(g.id, keep);
      return next;
    });
  };

  const keepNewest = (g: DuplicateGroup) => {
    const newest = [...g.files].sort((a, b) => b.modified - a.modified)[0];
    setSelected((prev) => {
      const next = new Map(prev);
      const keep = new Set(g.files.filter((f) => f.path !== newest.path).map((f) => f.path));
      next.set(g.id, keep);
      return next;
    });
  };

  const toggleInGroup = (g: DuplicateGroup, p: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const set = new Set(prev.get(g.id) ?? []);
      if (set.has(p)) set.delete(p);
      else set.add(p);
      next.set(g.id, set);
      return next;
    });
  };

  const toDelete = useMemo(() => {
    // Règle de sécurité : il faut toujours conserver au moins un exemplaire par
    // groupe. Un groupe dont toutes les copies sont cochées est donc ignoré.
    const list: { path: string; size: number }[] = [];
    for (const g of groups ?? []) {
      const sel = selected.get(g.id) ?? new Set();
      if (sel.size >= g.files.length) continue;
      for (const f of g.files) if (sel.has(f.path)) list.push({ path: f.path, size: f.size });
    }
    const bytes = list.reduce((a, f) => a + f.size, 0);
    return { files: list, bytes };
  }, [groups, selected]);

  const doDelete = async (mode: "recycle" | "permanent") => {
    if (!confirm || !scanId) return;
    try {
      const res = await window.nova.cleanup({ kind: "duplicate", paths: confirm.files.map((f) => f.path), mode });
      pushToast({
        kind: res.succeeded > 0 ? "success" : "warning",
        title: `${formatBytes(res.bytesFreed)} libérés`,
        message: "Vérifiez qu'aucune copie nécessaire n'a été supprimée (une copie par groupe est conservée).",
      });
      const removed = new Set(confirm.files.map((f) => f.path));
      setGroups((prev) => (prev ?? []).filter((g) => g.files.some((f) => !removed.has(f.path))));
      setConfirm(null);
    } catch (e) {
      pushToast({ kind: "error", title: "Échec", message: (e as Error).message });
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Doublons</h1>
          <p className="page-sub">
            Fichiers volumineux identiques au niveau du contenu (comparaison par hash). Nova ne supprime jamais
            automatiquement : gardez au moins un exemplaire.
          </p>
        </div>
      </div>

      <div className="row mb-4" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className="tag">{groups?.length ?? 0} groupes de doublons</span>
        <span className="tag good" style={{ color: "#86efac" }}>Espace potentiellement gagné : {formatBytes(totalWaste)}</span>
        {toDelete.files.length > 0 && (
          <button className="btn btn-sm btn-danger" style={{ marginLeft: "auto" }} onClick={() => setConfirm(toDelete)}>
            🗑 Supprimer {toDelete.files.length} exemplaires ({formatBytes(toDelete.bytes)})
          </button>
        )}
      </div>

      {busy && (
        <div className="card" style={{ display: "grid", placeItems: "center", minHeight: 200 }}>
          <LoadingBar label="Hachage des fichiers volumineux en cours… (peut prendre un moment)" />
        </div>
      )}

      {!busy && groups !== null && groups.length === 0 && (
        <EmptyState icon="🟢" title="Aucun doublon volumineux" sub="Aucun groupe de fichiers volumineux identiques n'a été trouvé." />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {groups?.map((g) => {
          const sel = selected.get(g.id) ?? new Set();
          const allSelected = sel.size >= g.files.length;
          const canDelete = sel.size >= 1 && !allSelected;
          return (
            <div className="reco-group open" key={g.id}>
              <div className="reco-head" style={{ cursor: "default" }}>
                <span className="reco-icon">≣</span>
                <div className="flex-1">
                  <div className="reco-title">{g.files[0]?.name} <span className="muted small">× {g.files.length}</span></div>
                  <div className="reco-desc">{formatBytes(g.size)} par copie · hash {g.hash.slice(0, 12)}…</div>
                </div>
                <span className="tag">{formatBytes(g.totalBytes)} à récupérer</span>
              </div>
              <div className="reco-body">
                <div className="row" style={{ padding: "10px 20px", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--border)" }}>
                  <button className="btn btn-sm" onClick={() => keepOldest(g)}>Conserver le plus ancien</button>
                  <button className="btn btn-sm" onClick={() => keepNewest(g)}>Conserver le plus récent</button>
                  <button className="btn btn-sm" onClick={() => keepOne(g)}>Conserver une copie (choix)</button>
                </div>
                {g.files.map((f) => (
                  <div key={f.path} className={`file-row ${sel.has(f.path) ? "selected" : ""}`}>
                    <div className={`checkbox ${sel.has(f.path) ? "checked" : ""}`} onClick={() => toggleInGroup(g, f.path)}>
                      {sel.has(f.path) ? "✓" : ""}
                    </div>
                    <span className="file-name">{f.name}</span>
                    <span className="path-cell" style={{ flex: 2 }}>{f.path}</span>
                    <span className="file-size">{formatBytes(f.size)}</span>
                    <span className="file-date">{new Date(f.modified).toLocaleDateString("fr-FR")}</span>
                  </div>
                ))}
                <div className="row-between" style={{ padding: "12px 20px" }}>
                  <span className="small muted">
                    {sel.size} exemplaire(s) cochés → supprimer {formatBytes(Array.from(g.files).filter((f) => sel.has(f.path)).reduce((a, f) => a + f.size, 0))}
                    {allSelected && <span style={{ color: "var(--warn)" }}> · conservez au moins un exemplaire</span>}
                  </span>
                  <button className="btn btn-sm btn-danger" disabled={!canDelete} title={allSelected ? "Conservez au moins un exemplaire avant de supprimer." : undefined} onClick={() => setConfirm({
                    files: g.files.filter((f) => sel.has(f.path)).map((f) => ({ path: f.path, size: f.size })),
                    bytes: g.files.filter((f) => sel.has(f.path)).reduce((a, f) => a + f.size, 0),
                  })}>
                    Supprimer les exemplaires cochés
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {confirm && (
        <ConfirmDelete
          fileCount={confirm.files.length}
          bytes={confirm.bytes}
          onClose={() => setConfirm(null)}
          onConfirm={(mode) => doDelete(mode)}
          permanentReason="Assurez-vous de conserver au moins un exemplaire de ce fichier avant la suppression définitive."
        />
      )}
    </div>
  );
}
