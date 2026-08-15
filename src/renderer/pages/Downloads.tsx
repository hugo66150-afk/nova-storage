import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store";
import type { FileCandidate } from "../../shared/types";
import { formatBytes } from "../../shared/types";
import { FileTable } from "../components/FileTable";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { EmptyState, StatCard } from "../components/ui";
import { invalidatePagedCache, usePagedFiles } from "../hooks/usePagedFiles";

export function Downloads() {
  const { scanState, setPage, pushToast } = useApp();
  const scanId = scanState.lastResult?.scanId;
  const pagedKey = scanId ? `scan:${scanId}:downloads` : "";
  const paged = usePagedFiles(
    pagedKey,
    useMemo(
      () =>
        (offset: number, limit: number) =>
          scanId ? window.nova.getDownloads(scanId, offset, limit) : Promise.resolve({ items: [], total: 0, totalBytes: 0 }),
      [scanId],
    ),
  );
  const files = paged.items;
  const totalBytes = paged.totalBytes;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ files: FileCandidate[]; bytes: number } | null>(null);

  useEffect(() => {
    setSelected(new Set());
  }, [scanId]);

  const stats = useMemo(() => {
    const now = Date.now();
    const olderThan90 = files.filter((f) => f.modified < now - 90 * 86400000);
    const big = files.filter((f) => f.size > 1024 ** 3);
    const installers = files.filter((f) => /\.(exe|msi|msix|appx|dmg|pkg)$/i.test(f.name));
    const archives = files.filter((f) => /\.(zip|rar|7z|tar|gz)$/i.test(f.name));
    const videos = files.filter((f) => /\.(mp4|mkv|avi|mov)$/i.test(f.name));
    const bytes = (l: FileCandidate[]) => l.reduce((a, f) => a + f.size, 0);
    return [
      { label: "Téléchargements anciens (> 90 j)", value: bytes(olderThan90), count: olderThan90.length },
      { label: "Gros fichiers (> 1 Go)", value: bytes(big), count: big.length },
      { label: "Installateurs", value: bytes(installers), count: installers.length },
      { label: "Archives", value: bytes(archives), count: archives.length },
      { label: "Vidéos", value: bytes(videos), count: videos.length },
    ].sort((a, b) => b.value - a.value);
  }, [files]);

  if (!scanId) {
    return (
      <EmptyState icon="📥" title="Analysez d'abord votre disque" sub="Le contenu du dossier Téléchargements est identifié pendant l'analyse." action={<button className="btn btn-primary" onClick={() => setPage("analyze")}>Analyser</button>} />
    );
  }

  const toggle = (p: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const selBytes = files.filter((f) => selected.has(f.path)).reduce((a, f) => a + f.size, 0);

  const doDelete = async (mode: "recycle" | "permanent") => {
    if (!confirm || !scanId) return;
    try {
      const res = await window.nova.cleanup({ kind: "download", paths: confirm.files.map((f) => f.path), mode });
      pushToast({ kind: res.succeeded > 0 ? "success" : "warning", title: `${formatBytes(res.bytesFreed)} libérés`, message: `${res.succeeded}/${confirm.files.length} éléments supprimés.` });
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

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Téléchargements</h1>
          <p className="page-sub">Votre dossier de téléchargements : installeurs, archives et fichiers accumulés au fil du temps.</p>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 20 }}>
        <StatCard icon="📥" label="Taille totale" value={formatBytes(totalBytes)} sub={`${paged.total} fichiers`} delay={0} />
        {stats.slice(0, 4).map((s, i) => (
          <StatCard key={s.label} icon="📄" label={s.label} value={formatBytes(s.value)} sub={`${s.count} fichiers`} delay={i * 60} />
        ))}
      </div>

      <div className="row-between mb-4">
        <span className="muted">Vérifiez avant de supprimer — certains téléchargements peuvent être nécessaires.</span>
        {selected.size > 0 && (
          <div className="row" style={{ gap: 10 }}>
            <span className="tag">{selected.size} sélectionnés · {formatBytes(selBytes)}</span>
            <button className="btn btn-sm btn-danger" onClick={() => setConfirm({ files: files.filter((f) => selected.has(f.path)), bytes: selBytes })}>🗑 Supprimer</button>
          </div>
        )}
      </div>

      <FileTable
        files={files}
        selected={selected}
        onToggle={toggle}
        onToggleAll={() => setSelected((prev) => (prev.size >= files.length ? new Set() : new Set(files.map((f) => f.path))))}
        total={paged.total}
        hasMore={paged.hasMore}
        onLoadMore={paged.loadMore}
        loadingMore={paged.loadingMore}
      />

      {confirm && (
        <ConfirmDelete
          fileCount={confirm.files.length}
          bytes={confirm.bytes}
          onClose={() => setConfirm(null)}
          onConfirm={(mode) => doDelete(mode)}
        />
      )}
    </div>
  );
}
