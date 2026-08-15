import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store";
import type { Category, FileCandidate, ScanResult } from "../../shared/types";
import { CATEGORIES, CATEGORY_COLORS, CATEGORY_ICONS, CATEGORY_LABELS, formatBytes } from "../../shared/types";
import { BarChart } from "../components/charts";
import { EmptyState, LoadingBar } from "../components/ui";
import { FileTable } from "../components/FileTable";
import { usePagedFiles } from "../hooks/usePagedFiles";

export function Categories() {
  const { scanState, setPage } = useApp();
  const scanId = scanState.lastResult?.scanId;
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [active, setActive] = useState<Category | null>(null);

  useEffect(() => {
    if (!scanId) return;
    void window.nova.getScanResult(scanId).then(setScan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  const pagedKey = scanId && active ? `scan:${scanId}:category:${active}` : "";
  const files = usePagedFiles(
    pagedKey,
    useMemo(
      () =>
        (offset: number, limit: number) =>
          scanId && active
            ? window.nova.getByCategory(scanId, active, offset, limit)
            : Promise.resolve({ items: [], total: 0, totalBytes: 0 }),
      [scanId, active],
    ),
  );

  const aggregates = useMemo(() => {
    if (!scan) return [];
    const map = new Map(scan.categories.map((c) => [c.category, c]));
    return CATEGORIES.map((c) => {
      const a = map.get(c) ?? { bytes: 0, files: 0 };
      return { category: c, bytes: a.bytes, files: a.files };
    }).sort((a, b) => b.bytes - a.bytes);
  }, [scan]);

  if (!scan) {
    return (
      <EmptyState icon="▦" title="Analysez d'abord votre disque" sub="La répartition par catégorie provient de la dernière analyse." action={<button className="btn btn-primary" onClick={() => setPage("analyze")}>Analyser</button>} />
    );
  }

  const total = scan.totalBytes || 1;
  const filesList: FileCandidate[] = files.items;
  const activeBytes = aggregates.find((a) => a.category === active)?.bytes ?? 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Catégories</h1>
          <p className="page-sub">Nova classe chaque élément selon son type, son emplacement et son contexte. Cliquez sur une catégorie pour voir ses fichiers.</p>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1.4fr", gap: 20 }}>
        <div className="card">
          <h3>Répartition</h3>
          <div className="mt-4">
            <BarChart
              data={aggregates.filter((a) => a.bytes > 0).map((a) => ({
                key: a.category,
                label: CATEGORY_LABELS[a.category],
                value: a.bytes,
                color: CATEGORY_COLORS[a.category],
              }))}
            />
          </div>
        </div>

        <div>
          <div className="pill-row mb-4">
            {aggregates.filter((a) => a.bytes > 0).map((a) => (
              <button
                key={a.category}
                className="tag"
                onClick={() => setActive(a.category)}
                style={
                  active === a.category
                    ? { background: `${CATEGORY_COLORS[a.category]}33`, borderColor: CATEGORY_COLORS[a.category], color: "#fff", cursor: "pointer" }
                    : { cursor: "pointer" }
                }
              >
                {CATEGORY_ICONS[a.category]} {CATEGORY_LABELS[a.category]}
                <strong style={{ marginLeft: 4 }}>{formatBytes(a.bytes)}</strong>
              </button>
            ))}
          </div>

          {active ? (
            files.loading ? (
              <div className="card" style={{ display: "grid", placeItems: "center", minHeight: 200 }}>
                <LoadingBar label="Chargement des fichiers…" />
              </div>
            ) : (
              <>
                <div className="row-between mb-4">
                  <div className="row" style={{ gap: 8 }}>
                    <span className="reco-icon">{CATEGORY_ICONS[active]}</span>
                    <span style={{ fontWeight: 700 }}>{CATEGORY_LABELS[active]}</span>
                    <span className="muted small">
                      {filesList.length} fichiers affichés sur {files.total} · {formatBytes(files.totalBytes)}
                    </span>
                    <span className="muted xs">({((activeBytes / total) * 100).toFixed(1)} % du stockage analysé)</span>
                  </div>
                  <button className="btn btn-sm btn-ghost" onClick={() => setActive(null)}>Fermer</button>
                </div>
                <FileTable
                  files={filesList}
                  searchable={false}
                  total={files.total}
                  hasMore={files.hasMore}
                  onLoadMore={files.loadMore}
                  loadingMore={files.loadingMore}
                />
              </>
            )
          ) : (
            <EmptyState icon="👆" title="Choisissez une catégorie" sub="Les fichiers sont triés par taille décroissante (liste paginée)." />
          )}
        </div>
      </div>
    </div>
  );
}
