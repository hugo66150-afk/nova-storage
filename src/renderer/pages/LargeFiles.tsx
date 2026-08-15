import { useMemo, useState } from "react";
import { useApp } from "../state/store";
import type { FileCandidate } from "../../shared/types";
import { formatBytes } from "../../shared/types";
import { FileTable } from "../components/FileTable";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { EmptyState, Segmented } from "../components/ui";
import { invalidatePagedCache, usePagedFiles } from "../hooks/usePagedFiles";

const FILTERS: Array<{ value: number; label: string }> = [
  { value: 50 * 1024 ** 2, label: "> 50 Mo" },
  { value: 100 * 1024 ** 2, label: "> 100 Mo" },
  { value: 1024 ** 3, label: "> 1 Go" },
  { value: 5 * 1024 ** 3, label: "> 5 Go" },
  { value: 10 * 1024 ** 3, label: "> 10 Go" },
];

export function LargeFiles() {
  const { scanState, setPage, pushToast } = useApp();
  const scanId = scanState.lastResult?.scanId;
  const [minSize, setMinSize] = useState(1024 ** 3);
  const pagedKey = scanId ? `scan:${scanId}:large:${minSize}` : "";
  const paged = usePagedFiles(
    pagedKey,
    useMemo(
      () =>
        (offset: number, limit: number) =>
          scanId ? window.nova.getLargeFiles(scanId, minSize, offset, limit) : Promise.resolve({ items: [], total: 0, totalBytes: 0 }),
      [scanId, minSize],
    ),
  );
  const files = paged.items;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ files: FileCandidate[]; bytes: number } | null>(null);

  const doDelete = async (mode: "recycle" | "permanent") => {
    if (!confirm || !scanId) return;
    try {
      const res = await window.nova.cleanup({ kind: "large", paths: confirm.files.map((f) => f.path), mode });
      pushToast({ kind: res.succeeded > 0 ? "success" : "warning", title: `${formatBytes(res.bytesFreed)} libérés`, message: `${res.items.filter((i) => i.status === "protected" || i.status === "locked").length} éléments protégés ou verrouillés.` });
      if (scanId) {
        invalidatePagedCache(scanId);
        paged.reload();
      }
      setSelected(new Set());
    } catch (e) {
      pushToast({ kind: "error", title: "Échec", message: (e as Error).message });
    } finally {
      setConfirm(null);
    }
  };

  const exclude = async (f: FileCandidate) => {
    await window.nova.addExclusion({ path: f.path, kind: f.isDir ? "folder" : "file" });
    paged.reload();
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(f.path);
      return next;
    });
    pushToast({ kind: "info", title: "Élément exclu", message: `${f.name} ne sera plus proposé au nettoyage.` });
  };

  if (!scanId) {
    return (
      <EmptyState icon="▣" title="Analysez d'abord votre disque" sub="Les fichiers volumineux sont identifiés pendant l'analyse complète." action={<button className="btn btn-primary" onClick={() => setPage("analyze")}>Analyser</button>} />
    );
  }

  const toggle = (p: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => (prev.size >= files.length ? new Set() : new Set(files.map((f) => f.path))));

  const bytes = files.filter((f) => selected.has(f.path)).reduce((a, f) => a + f.size, 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Fichiers volumineux</h1>
          <p className="page-sub">Les plus gros fichiers de votre disque. Vérifiez avant de supprimer : certains méritent d'être déplacés ou archivés.</p>
        </div>
        <Segmented value={minSize} onChange={setMinSize} options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
      </div>

      <div className="row-between mb-4">
        <span className="muted">{paged.total} fichiers de {formatBytes(minSize)} ou plus · {formatBytes(paged.totalBytes)} au total</span>
        {selected.size > 0 && (
          <div className="row" style={{ gap: 10 }}>
            <span className="tag">{selected.size} sélectionnés · {formatBytes(bytes)}</span>
            <button className="btn btn-sm btn-danger" onClick={() => setConfirm({ files: files.filter((f) => selected.has(f.path)), bytes })}>
              🗑 Supprimer
            </button>
          </div>
        )}
      </div>

      <FileTable
        files={files}
        selected={selected}
        onToggle={toggle}
        onToggleAll={toggleAll}
        onDelete={(f) => setConfirm({ files: [f], bytes: f.size })}
        onExclude={(f) => void exclude(f)}
        total={paged.total}
        hasMore={paged.hasMore}
        onLoadMore={paged.loadMore}
        loadingMore={paged.loadingMore}
      />
      <div className="small muted mt-4">
        ✦ Action disponible sur chaque ligne : ouvrir, emplacement, copier le chemin, envoyer à la corbeille ou exclure.
      </div>

      {confirm && (
        <ConfirmDelete
          fileCount={confirm.files.length}
          bytes={confirm.bytes}
          onClose={() => setConfirm(null)}
          onConfirm={(mode) => doDelete(mode)}
          permanentReason="La suppression définitive d'un fichier volumineux est irréversible."
        />
      )}
    </div>
  );
}
