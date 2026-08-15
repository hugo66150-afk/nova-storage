import { useMemo, useState } from "react";
import { useApp } from "../state/store";
import { formatBytes } from "../../shared/types";
import { FileTable } from "../components/FileTable";
import { EmptyState, Segmented } from "../components/ui";
import { usePagedFiles } from "../hooks/usePagedFiles";

const AGES = [
  { days: 30, label: "> 30 jours" },
  { days: 90, label: "> 90 jours" },
  { days: 180, label: "> 6 mois" },
  { days: 365, label: "> 1 an" },
  { days: 730, label: "> 2 ans" },
];

export function OldFiles() {
  const { scanState, setPage } = useApp();
  const scanId = scanState.lastResult?.scanId;
  const [days, setDays] = useState(180);
  const pagedKey = scanId ? `scan:${scanId}:old:${days}` : "";
  const paged = usePagedFiles(
    pagedKey,
    useMemo(
      () =>
        (offset: number, limit: number) =>
          scanId ? window.nova.getOldFiles(scanId, days, offset, limit) : Promise.resolve({ items: [], total: 0, totalBytes: 0 }),
      [scanId, days],
    ),
  );
  const files = paged.items;

  if (!scanId) {
    return (
      <EmptyState icon="◷" title="Analysez d'abord votre disque" sub="Les fichiers anciens sont repérés pendant l'analyse complète." action={<button className="btn btn-primary" onClick={() => setPage("analyze")}>Analyser</button>} />
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Fichiers anciens</h1>
          <p className="page-sub">
            Un fichier ancien ne signifie pas qu'il est inutile. Nova les liste pour vous permettre de trancher
            en connaissance de cause.
          </p>
        </div>
        <Segmented value={days} onChange={setDays} options={AGES.map((a) => ({ value: a.days, label: a.label }))} />
      </div>

      <div className="row-between mb-4">
        <span className="muted">{paged.total} fichiers non modifiés depuis plus de {days} jours · {formatBytes(paged.totalBytes)} au total</span>
      </div>

      <FileTable
        files={files}
        total={paged.total}
        hasMore={paged.hasMore}
        onLoadMore={paged.loadMore}
        loadingMore={paged.loadingMore}
      />
    </div>
  );
}
