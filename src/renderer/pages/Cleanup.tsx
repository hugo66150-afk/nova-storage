import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useApp } from "../state/store";
import type { CandidateKind, FileCandidate, RecommendationGroup } from "../../shared/types";
import { formatBytes, formatNumber } from "../../shared/types";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { EmptyState, ProgressBar, SafetyBadge } from "../components/ui";
import { invalidatePagedCache, usePagedFiles } from "../hooks/usePagedFiles";

const KIND_ICONS: Record<string, string> = {
  temp: "🧹",
  cache: "🗄️",
  recyclebin: "🗑️",
  large: "🐘",
  old: "⏳",
  download: "📥",
  archive: "📦",
  duplicate: "≣",
  logs: "📃",
  crash: "💥",
  thumbnail: "🖼",
};

export function Cleanup() {
  const { overview, scanState, refreshOverview, pushToast, setPage, prefs } = useApp();
  const scanId = scanState.lastResult?.scanId;

  const [openKey, setOpenKey] = useState<CandidateKind | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ files: FileCandidate[]; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string; bytesFreed: number } | null>(null);
  const [recycleModal, setRecycleModal] = useState(false);
  const [recycleInfo, setRecycleInfo] = useState<{ bytes: number; files: number } | null>(null);

  const groups = overview?.recoverable.groups ?? [];

  const pagedKey = scanId && openKey ? `scan:${scanId}:detail:${openKey}` : "";
  const detail = usePagedFiles(
    pagedKey,
    useCallback(
      (offset: number, limit: number) =>
        scanId && openKey
          ? window.nova.getRecommendationDetail(scanId, openKey, offset, limit).then((d) => ({
              items: d?.samples ?? [],
              total: d?.total ?? 0,
              totalBytes: d?.totalBytes ?? 0,
            }))
          : Promise.resolve({ items: [], total: 0, totalBytes: 0 }),
      [scanId, openKey],
    ),
  );

  const openGroup = (key: CandidateKind) => {
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(key);
    setSelected(new Set());
  };

  useEffect(() => {
    setOpenKey(null);
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  const closeAll = () => {
    setConfirm(null);
    setOpenKey(null);
  };

  const samples = detail.items;
  const detailTotal = detail.total;
  const selectedFiles = useMemo(() => {
    if (!openKey) return [];
    return selected.size === 0 ? samples : samples.filter((f) => selected.has(f.path));
  }, [samples, selected, openKey]);

  const promptDelete = (files: FileCandidate[]) => {
    const bytes = files.reduce((a, f) => a + f.size, 0);
    setConfirm({ files, bytes });
  };

  const doCleanup = useCallback(
    async (files: FileCandidate[], mode: "recycle" | "permanent", groupKey: CandidateKind) => {
      setBusy(true);
      setProgress({ done: 0, total: files.length, current: "", bytesFreed: 0 });
      const paths = files.map((f) => f.path);
      const off = window.nova.onCleanupProgress(setProgress);
      try {
        const result = await window.nova.cleanup({ kind: groupKey, paths, mode });
        pushToast({
          kind: result.succeeded > 0 ? "success" : "warning",
          title: `${formatBytes(result.bytesFreed)} libérés`,
          message:
            result.succeeded > 0
              ? `${result.items.filter((i) => i.status === "protected" || i.status === "locked").length} éléments protégés ou verrouillés ignorés.`
              : "Aucun élément n'a pu être supprimé (protégé ou verrouillé).",
        });
        if (scanId) invalidatePagedCache(scanId);
      } catch (e) {
        pushToast({ kind: "error", title: "Échec du nettoyage", message: (e as Error).message });
      } finally {
        off();
        setBusy(false);
        setProgress(null);
        setConfirm(null);
        setOpenKey(null);
        await refreshOverview();
        if (mode === "permanent") {
          pushToast({ kind: "info", title: "Espace réellement récupéré", message: "Consultez l'historique pour suivre vos nettoyages." });
        }
      }
    },
    [scanId, pushToast, refreshOverview],
  );

  const runCleanup = useCallback(
    async (mode: "recycle" | "permanent") => {
      if (!confirm || !openKey) return;
      await doCleanup(confirm.files, mode, openKey);
    },
    [confirm, openKey, doCleanup],
  );

  const emptyBin = async () => {
    if (!scanId) return;
    setBusy(true);
    try {
      const { freedBytes } = await window.nova.emptyRecycleBin();
      pushToast({
        kind: freedBytes > 0 ? "success" : "info",
        title: freedBytes > 0 ? `Corbeille vidée : ${formatBytes(freedBytes)} libérés` : "Corbeille déjà vide",
      });
    } catch (e) {
      pushToast({ kind: "error", title: "Impossible de vider la corbeille", message: (e as Error).message });
    } finally {
      setBusy(false);
      setRecycleModal(false);
      setRecycleInfo(null);
      await refreshOverview();
    }
  };

  const openRecycleModal = async () => {
    setRecycleModal(true);
    setRecycleInfo(null);
    try {
      const info = await window.nova.getRecycleBinInfo();
      if (info.files === 0) {
        setRecycleModal(false);
        pushToast({ kind: "info", title: "Corbeille déjà vide", message: "Rien à supprimer dans la corbeille Windows." });
        return;
      }
      setRecycleInfo(info);
    } catch {
      setRecycleInfo(null);
    }
  };

  const autoCleanTemp = prefs?.tempCleanupRequiresConfirm === false;

  if (!scanId) {
    return (
      <EmptyState
        icon="✦"
        title="Analyse d'abord, nettoyage ensuite"
        sub="Lancez une analyse pour que Nova identifie précisément ce qui peut être nettoyé en toute sécurité. Nova ne nettoie jamais à l'aveugle."
        action={<button className="btn btn-primary" onClick={() => setPage("analyze")}>Lancer une analyse</button>}
      />
    );
  }

  const totalRecoverable = overview?.recoverable.totalBytes ?? 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Libérer de l'espace</h1>
          <p className="page-sub">
            Nova identifie ce qui peut être supprimé sans risque, puis vous fait valider chaque étape.
            Rien n'est supprimé sans votre confirmation explicite.
          </p>
        </div>
      </div>

      <div className="card hero mb-5" style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div className="stat-label">Espace potentiellement récupérable</div>
          <div className="stat-value" style={{ fontSize: 44, marginTop: 4 }}>
            {formatBytes(totalRecoverable)}
          </div>
          <div className="small muted mt-2">Basé sur la dernière analyse · toujours vérifiable avant suppression</div>
        </div>
        <div className="flex-1" style={{ minWidth: 220 }}>
          <ProgressBar value={Math.min(100, (totalRecoverable / Math.max(1, scanState.lastResult?.totalBytes ?? 1)) * 100)} tone="good" height={12} />
          <div className="row-between small muted mt-2">
            <span>Récupérable</span>
            <span>{scanState.lastResult?.totalBytes ? ((totalRecoverable / scanState.lastResult.totalBytes) * 100).toFixed(1) : 0}% du volume analysé</span>
          </div>
        </div>
      </div>

      {busy && progress && (
        <div className="card mb-5" style={{ maxWidth: 640 }}>
          <div className="row-between mb-2">
            <strong>Suppression en cours…</strong>
            <span className="muted">{Math.round((progress.done / Math.max(1, progress.total)) * 100)} % · {formatBytes(progress.bytesFreed)} libérés</span>
          </div>
          <ProgressBar value={(progress.done / Math.max(1, progress.total)) * 100} height={12} />
          <div className="mono xs faint mt-2" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{progress.current}</div>
        </div>
      )}

      {groups.length === 0 && (
        <EmptyState
          icon="🟢"
          title="Rien à nettoyer pour l'instant"
          sub="Aucun élément nettoyable n'a été détecté lors de la dernière analyse. Lancez une nouvelle analyse pour lancer un autre cycle."
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {groups.map((g) => (
          <RecommendationCard
            key={g.key}
            group={g}
            open={openKey === g.key}
            onToggle={() => openGroup(g.key)}
            samples={openKey === g.key ? samples : []}
            total={openKey === g.key ? detailTotal : 0}
            hasMore={openKey === g.key ? detail.hasMore : false}
            loadingMore={openKey === g.key ? detail.loadingMore : false}
            onLoadMore={openKey === g.key ? detail.loadMore : undefined}
            selected={selected}
            onToggleFile={(p) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(p)) next.delete(p);
                else next.add(p);
                return next;
              })
            }
            onSelectRange={(paths) => setSelected(new Set(paths))}
            onSelectAll={() => {
              if (openKey) {
                if (selected.size >= samples.length) setSelected(new Set());
                else setSelected(new Set(samples.map((f) => f.path)));
              }
            }}
            onDelete={() =>
              autoCleanTemp && g.key === "temp"
                ? void doCleanup(selectedFiles.length > 0 ? selectedFiles : samples, "recycle", g.key)
                : promptDelete(selectedFiles)
            }
            onEmptyBin={() => void openRecycleModal()}
            autoClean={autoCleanTemp && g.key === "temp"}
            disabled={busy}
          />
        ))}
      </div>

      {confirm && (
        <ConfirmDelete
          fileCount={confirm.files.length}
          bytes={confirm.bytes}
          onClose={closeAll}
          onConfirm={(mode) => runCleanup(mode)}
          permanentReason={
            openKey === "recyclebin"
              ? "La corbeille sera vidée définitivement (Clear-RecycleBin / Force)."
              : openKey === "old"
                ? "Les fichiers anciens ne sont pas forcément inutiles : vous confirmez votre choix."
                : undefined
          }
        />
      )}

      {recycleModal && recycleInfo && (
        <ConfirmDelete
          fileCount={recycleInfo.files}
          bytes={recycleInfo.bytes}
          onClose={() => {
            setRecycleModal(false);
            setRecycleInfo(null);
          }}
          onConfirm={() => emptyBin()}
          permanentReason="Vider la corbeille supprime définitivement son contenu. Action irréversible."
        />
      )}
    </div>
  );
}

function RecommendationCard({
  group,
  open,
  onToggle,
  samples,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  selected,
  onToggleFile,
  onSelectAll,
  onSelectRange,
  onDelete,
  onEmptyBin,
  autoClean = false,
  disabled,
}: {
  group: RecommendationGroup;
  open: boolean;
  onToggle: () => void;
  samples: FileCandidate[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore?: () => void;
  selected: Set<string>;
  onToggleFile: (p: string) => void;
  onSelectAll: () => void;
  onSelectRange: (paths: string[]) => void;
  onDelete: () => void;
  onEmptyBin: () => void;
  autoClean?: boolean;
  disabled: boolean;
}) {
  const isAll = samples.length > 0 && selected.size >= samples.length;
  const selectedBytes = samples.filter((f) => selected.has(f.path)).reduce((a, f) => a + f.size, 0);

  // Sélection par clic / glisser (on reste appuyé en descendant).
  const dragStart = useRef<number | null>(null);
  const dragMoved = useRef(false);

  useEffect(() => {
    const up = () => {
      if (dragStart.current !== null && !dragMoved.current) {
        const path = samples[dragStart.current]?.path;
        if (path) onToggleFile(path);
      }
      dragStart.current = null;
      dragMoved.current = false;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, onToggleFile]);

  const handleRowMouseDown = (index: number) => {
    dragStart.current = index;
    dragMoved.current = false;
  };

  const handleRowMouseEnter = (index: number) => {
    if (dragStart.current === null) return;
    dragMoved.current = true;
    const a = dragStart.current;
    const [lo, hi] = a < index ? [a, index] : [index, a];
    const range = samples.slice(lo, hi + 1).map((f) => f.path);
    onSelectRange(range);
  };

  const handleRowKeyDown = (e: ReactKeyboardEvent, index: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggleFile(samples[index].path);
    }
  };

  return (
    <div className={`reco-group ${open ? "open" : ""}`}>
      <div className="reco-head" onClick={onToggle}>
        <span className="reco-icon">{KIND_ICONS[group.key]}</span>
        <div className="flex-1">
          <div className="reco-title">{group.title}</div>
          <div className="reco-desc">{group.description}</div>
        </div>
        <SafetyBadge level={group.risk} />
        <div style={{ textAlign: "right" }}>
          <div className="reco-size">{formatBytes(group.bytes)}</div>
          <div className="xs muted">{formatNumber(group.files)} éléments · confiance {group.confidence}%</div>
        </div>
        <span style={{ color: "var(--text-faint)" }}>{open ? "▾" : "▸"}</span>
      </div>

      {open && group.key === "recyclebin" && (
        <div className="reco-body" style={{ padding: "var(--space-5)" }}>
          <div className="insight warn" style={{ marginBottom: 16, background: "var(--warn-soft)", borderColor: "rgba(245,158,11,0.3)" }}>
            <span className="insight-ico">🗑️</span>
            <div>
              <div className="insight-title">Vider la corbeille Windows</div>
              <p className="insight-msg">
                Environ {formatBytes(group.bytes)} dans la corbeille. Une fois vidée, les fichiers ne seront plus
                récupérables. Nova ne supprime jamais d'autres éléments de la corbeille.
              </p>
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-danger" onClick={onEmptyBin} disabled={disabled}>🗑 Vider la corbeille</button>
          </div>
        </div>
      )}

      {open && group.key !== "recyclebin" && (
        <div className="reco-body">
          {autoClean && (
            <div className="insight warn" style={{ marginBottom: 16, background: "var(--warn-soft)", borderColor: "rgba(245,158,11,0.3)" }}>
              <span className="insight-ico">⚡</span>
              <div>
                <div className="insight-title">Nettoyage automatique activé</div>
                <p className="insight-msg">
                  Les fichiers temporaires seront supprimés en un clic, sans confirmation (paramètre
                  « Supprimer les fichiers temporaires sans confirmation »). Sélectionnez des fichiers pour ne
                  nettoyer qu'une partie, ou cliquez directement pour tout nettoyer.
                </p>
              </div>
            </div>
          )}

          {samples.length > 0 && (
            <div className="reco-toolbar">
              <div className="small muted">
                <button className="btn btn-sm btn-ghost" onClick={onSelectAll} disabled={disabled} title="Tout sélectionner / désélectionner">
                  <span className={`checkbox ${isAll ? "checked" : ""}`} style={{ marginRight: 8, verticalAlign: "middle" }}>{isAll ? "✓" : ""}</span>
                  {isAll ? "Tout désélectionner" : "Tout sélectionner"}
                </button>
                <span style={{ marginLeft: 12 }}>
                  {selected.size > 0
                    ? `${selected.size} sélectionné(s) · ${formatBytes(selectedBytes)}`
                    : `${samples.length} éléments affichés sur ${formatNumber(total)}`}
                </span>
              </div>
              <button
                className="btn btn-sm btn-primary"
                onClick={onDelete}
                disabled={disabled || (!autoClean && selected.size === 0)}
              >
                {autoClean ? `✦ Nettoyer maintenant (${formatBytes(selectedBytes || group.bytes)})` : `✦ Supprimer (${formatBytes(selectedBytes)})`}
              </button>
            </div>
          )}

          <div className="table-wrap selectable-rows">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <div className={`checkbox ${isAll ? "checked" : ""}`} onClick={onSelectAll} style={{ marginTop: 2 }}>
                      {isAll ? "✓" : ""}
                    </div>
                  </th>
                  <th>Nom</th>
                  <th style={{ textAlign: "right" }}>Taille</th>
                  <th>Modifié</th>
                  <th>Sécurité</th>
                  <th style={{ width: 60 }} className="sticky-actions" />
                </tr>
              </thead>
              <tbody>
                {samples.map((f, index) => (
                  <tr
                    key={f.path}
                    className={selected.has(f.path) ? "selected" : ""}
                    onMouseDown={() => handleRowMouseDown(index)}
                    onMouseEnter={() => handleRowMouseEnter(index)}
                    onKeyDown={(e) => handleRowKeyDown(e, index)}
                    tabIndex={0}
                    title={f.path}
                  >
                    <td>
                      <div className={`checkbox ${selected.has(f.path) ? "checked" : ""}`}>{selected.has(f.path) ? "✓" : ""}</div>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontWeight: 600 }}>{f.name}</span>
                        <span className="path-cell" title={f.path}>{f.path}</span>
                      </div>
                    </td>
                    <td className="size-cell">{formatBytes(f.size)}</td>
                    <td className="xs muted nowrap">{new Date(f.modified).toLocaleDateString("fr-FR")}</td>
                    <td><SafetyBadge level={f.safety} /></td>
                    <td className="sticky-actions" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        <button className="icon-btn" title="Ouvrir" onClick={() => void window.nova.openPath(f.path)}>⤢</button>
                        <button className="icon-btn" title="Copier le chemin" onClick={() => void window.nova.copyPath(f.path)}>⧉</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row-between" style={{ padding: "12px 20px" }}>
            <div className="small muted">
              {selected.size > 0
                ? `${selected.size} sélectionnés · ${formatBytes(selectedBytes)}`
                : `${samples.length} éléments affichés sur ${formatNumber(total)}`}
            </div>
            <div className="row" style={{ gap: 10 }}>
              {hasMore && (
                <button className="btn btn-sm btn-ghost" onClick={onLoadMore} disabled={disabled || loadingMore}>
                  {loadingMore ? "Chargement…" : `Charger plus (${formatNumber(total - samples.length)})`}
                </button>
              )}
              <button className="btn btn-sm btn-ghost" onClick={onToggle} disabled={disabled}>Fermer</button>
              <button
                className="btn btn-sm btn-primary"
                onClick={onDelete}
                disabled={disabled || (!autoClean && selected.size === 0)}
              >
                {autoClean ? `✦ Nettoyer maintenant (${formatBytes(selectedBytes || group.bytes)})` : `✦ Supprimer (${formatBytes(selectedBytes)})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
