import React, { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store";
import type { Category, DirChildrenResult, DirEntry, FileCandidate } from "../../shared/types";
import { CATEGORY_COLORS, CATEGORY_LABELS, formatBytes, formatNumber } from "../../shared/types";
import { Treemap, type TmItem } from "../components/Treemap";
import { EmptyState, LoadingBar, SafetyBadge, Segmented } from "../components/ui";

type View = "treemap" | "list";

export function Explorer() {
  const { scanState, setPage } = useApp();
  const scan = scanState.lastResult;
  const scanId = scan?.scanId;
  const root = scan?.root ?? "C:\\";

  const [view, setView] = useState<View>("treemap");
  const [currentPath, setCurrentPath] = useState<string>(root);
  const [data, setData] = useState<DirChildrenResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (p: string) => {
    if (!scanId) return;
    setLoading(true);
    try {
      const d = await window.nova.getDirChildren(scanId, p);
      setData(d);
      setCurrentPath(p);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (scanId) void load(root);
    else setData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  const crumbs = useMemo(() => {
    const parts = currentPath.split("\\").filter(Boolean);
    const acc: string[] = [];
    const list: Array<{ label: string; path: string }> = [];
    for (const p of parts) {
      acc.push(p);
      const joined = `${acc.join("\\")}\\`;
      list.push({ label: p, path: p === parts[0] ? `${acc[0]}\\` : joined });
    }
    return list;
  }, [currentPath]);

  const items: TmItem[] = useMemo(() => {
    if (!data) return [];
    const total = data.dirs.reduce((a, d) => a + d.size, 0) + data.files.reduce((a, f) => a + f.size, 0);
    const all: TmItem[] = [
      ...data.dirs.map((d) => ({
        key: `d:${d.path}`,
        label: d.name,
        value: d.size,
        color: CATEGORY_COLORS[d.category],
        fileCount: d.fileCount,
        meta: { isDir: true, path: d.path, category: d.category },
      })),
      ...data.files.map((f) => ({
        key: `f:${f.path}`,
        label: f.name,
        value: f.size,
        color: "rgba(148,163,184,0.5)",
        meta: { isDir: false, path: f.path },
      })),
    ].filter((i) => i.value > 0);

    if (all.length <= 400) return all;
    const sorted = all.sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, 399);
    const rest = sorted.slice(399);
    const restBytes = rest.reduce((a, r) => a + r.value, 0);
    const otherFiles = rest.filter((r) => !(r.meta as { isDir?: boolean })?.isDir).length;
    top.push({ key: "rest", label: `Autres (${rest.length} éléments)`, value: restBytes, color: "rgba(100,116,139,0.4)", fileCount: otherFiles });
    void total;
    return top;
  }, [data]);

  const onTileClick = (item: TmItem) => {
    const meta = item.meta as { isDir?: boolean; path?: string } | undefined;
    if (meta?.isDir && meta.path) void load(meta.path);
    else if (meta?.path) void window.nova.openPath(meta.path);
  };

  if (!scanId) {
    return (
      <EmptyState
        icon="❏"
        title="Aucune analyse à explorer"
        sub="Lancez une analyse complète d'un disque pour cartographier votre stockage et naviguer dans vos dossiers."
        action={<button className="btn btn-primary" onClick={() => setPage("analyze")}>Lancer une analyse</button>}
      />
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Explorateur</h1>
          <p className="page-sub">Parcourez votre stockage du disque jusqu'aux fichiers. Plus un bloc est grand, plus il occupe d'espace.</p>
        </div>
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "treemap", label: "❏ Cartographie" },
            { value: "list", label: "☰ Liste" },
          ]}
        />
      </div>

      <div className="card mb-4" style={{ padding: "12px 20px" }}>
        <div className="row-between" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="row" style={{ gap: 6 }}>
            <button className="icon-btn" title="Monter" onClick={() => data?.parentPath && void load(data.parentPath)} disabled={!data?.parentPath}>←</button>
            <div className="breadcrumb">
              {crumbs.map((c, i) => (
                <React.Fragment key={c.path}>
                  {i > 0 && <span className="crumb-sep">/</span>}
                  <span className={`crumb ${i === crumbs.length - 1 ? "current" : ""}`} onClick={() => void load(c.path)}>
                    {c.label}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
          {data && (
            <div className="row" style={{ gap: 12 }}>
              <span className="tag">🗂 {formatNumber(data.totalFiles)} fichiers</span>
              <span className="tag">📂 {formatNumber(data.totalDirs)} dossiers</span>
              <span className="tag" style={{ fontWeight: 700, color: "#d8c9ff" }}>{formatBytes(data.totalSize)}</span>
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="card" style={{ minHeight: 360, display: "grid", placeItems: "center" }}>
          <LoadingBar label="Chargement du dossier…" />
        </div>
      )}

      {!loading && data && view === "treemap" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="treemap-legend">
            <span className="tag">💡 Survolez pour voir la taille · cliquez pour naviguer</span>
            {Array.from(new Set(data.dirs.map((d) => d.category))).slice(0, 6).map((c) => (
              <span key={c} className="tag">
                <span style={{ width: 8, height: 8, borderRadius: 3, background: CATEGORY_COLORS[c as Category], display: "inline-block" }} />
                {CATEGORY_LABELS[c as Category]}
              </span>
            ))}
            <span className="tag">⬚ Fichiers</span>
          </div>
          <Treemap items={items} onItemClick={onTileClick} />
        </div>
      )}

      {!loading && data && view === "list" && <ListView data={data} onOpenDir={(p) => void load(p)} />}
    </div>
  );
}

function ListView({ data, onOpenDir }: { data: DirChildrenResult; onOpenDir: (p: string) => void }) {
  const rows: Array<DirEntry | FileCandidate> = [...data.dirs, ...data.files];
  const [sortKey, setSortKey] = useState<"name" | "size">("size");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const cmp = (sortKey === "size" ? a.size - b.size : a.name.localeCompare(b.name)) || b.size - a.size;
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, dir]);

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 34 }}>·</th>
            <th onClick={() => { setSortKey("name"); setDir((d) => (d === "asc" ? "desc" : "asc")); }}>Nom {sortKey === "name" ? (dir === "asc" ? "▲" : "▼") : ""}</th>
            <th onClick={() => { setSortKey("size"); setDir((d) => (d === "asc" ? "desc" : "asc")); }} style={{ textAlign: "right" }}>Taille {sortKey === "size" ? (dir === "asc" ? "▲" : "▼") : ""}</th>
            <th>Éléments</th>
            <th>Sécurité</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const isDir = (r as DirEntry).fileCount !== undefined;
            const path = (r as DirEntry).path ?? (r as FileCandidate).path;
            const safety = (r as DirEntry).safety ?? (r as FileCandidate).safety;
            return (
              <tr key={path} style={{ cursor: isDir ? "pointer" : "default" }} onClick={() => (isDir ? onOpenDir(path) : void window.nova.openPath(path))}>
                <td>{isDir ? "📁" : "📄"}</td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600 }}>{r.name}</span>
                    <span className="path-cell">{path}</span>
                  </div>
                </td>
                <td className="size-cell">{formatBytes(r.size)}</td>
                <td>{isDir ? `${(r as DirEntry).fileCount} f · ${(r as DirEntry).dirCount} d` : "—"}</td>
                <td><SafetyBadge level={safety} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}