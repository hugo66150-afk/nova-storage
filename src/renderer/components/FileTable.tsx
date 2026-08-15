import { useMemo, useState } from "react";
import type { FileCandidate } from "../../shared/types";
import { formatBytes, formatDate, formatNumber } from "../../shared/types";
import { CategoryTag, SafetyBadge } from "./ui";

type SortKey = "name" | "size" | "modified" | "category" | "safety";

export function FileTable({
  files,
  selected,
  onToggle,
  onToggleAll,
  searchable = true,
  onDelete,
  onExclude,
  compact = false,
  total,
  hasMore,
  onLoadMore,
  loadingMore,
}: {
  files: FileCandidate[];
  selected?: Set<string>;
  onToggle?: (path: string) => void;
  onToggleAll?: () => void;
  searchable?: boolean;
  onDelete?: (f: FileCandidate) => void;
  onExclude?: (f: FileCandidate) => void;
  compact?: boolean;
  total?: number;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("size");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? files.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            f.path.toLowerCase().includes(q) ||
            f.extension.toLowerCase().includes(q),
        )
      : files;
    return [...list].sort((a, b) => {
      const av = a[sortKey] as number | string;
      const bv = b[sortKey] as number | string;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });
  }, [files, search, sortKey, dir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setDir("desc");
    }
  };

  const arrow = (k: SortKey) => (sortKey === k ? (dir === "asc" ? " ▲" : " ▼") : "");

  const allSelected = selected && files.filter((f) => selected.has(f.path)).length > 0 && files.length > 0 && selected.size >= files.length;

  const header = (label: string, key: SortKey, align = "left") => (
    <th style={{ textAlign: align as "left" }} onClick={() => toggleSort(key)}>
      {label}
      {arrow(key)}
    </th>
  );

  return (
    <div>
      {searchable && files.length > 8 && (
        <div style={{ maxWidth: 320 }} className="mb-4 searchbox">
          <input className="input" placeholder="Rechercher un nom, chemin, extension…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {selected && onToggle && onToggleAll && (
                <th style={{ width: 34 }}>
                  <div
                    className={`checkbox ${allSelected ? "checked" : ""}`}
                    onClick={onToggleAll}
                    style={{ marginTop: 2 }}
                  >
                    {allSelected ? "✓" : ""}
                  </div>
                </th>
              )}
              {header("Nom", "name")}
              {header("Taille", "size", "right")}
              {header("Modifié", "modified")}
              {!compact && header("Catégorie", "category")}
              {!compact && header("Sécurité", "safety")}
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>
                  Aucun fichier ne correspond.
                </td>
              </tr>
            )}
            {filtered.map((f) => (
              <tr key={f.path} className={selected?.has(f.path) ? "selected" : ""}>
                {selected && onToggle && (
                  <td>
                    <div className={`checkbox ${selected.has(f.path) ? "checked" : ""}`} onClick={() => onToggle(f.path)}>
                      {selected.has(f.path) ? "✓" : ""}
                    </div>
                  </td>
                )}
                <td>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600 }}>{f.name}</span>
                    <span className="path-cell">{f.path}</span>
                  </div>
                </td>
                <td className="size-cell">{formatBytes(f.size)}</td>
                <td className="xs muted nowrap">{formatDate(f.modified)}</td>
                {!compact && (
                  <td>
                    <CategoryTag category={f.category} />
                  </td>
                )}
                {!compact && (
                  <td>
                    <SafetyBadge level={f.safety} />
                  </td>
                )}
                <td>
                  <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <button className="icon-btn" title="Ouvrir" onClick={() => void window.nova.openPath(f.path)}>⤢</button>
                    <button className="icon-btn" title="Emplacement" onClick={() => void window.nova.openInFolder(f.path)}>⌕</button>
                    <button className="icon-btn" title="Copier le chemin" onClick={() => void window.nova.copyPath(f.path)}>⧉</button>
                    {onDelete && <button className="icon-btn danger" title="Corbeille" onClick={() => onDelete(f)}>🗑</button>}
                    {onExclude && <button className="icon-btn" title="Exclure du nettoyage" onClick={() => onExclude(f)}>🚫</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && onLoadMore && (
        <div className="row" style={{ justifyContent: "center", padding: "14px 0" }}>
          <button className="btn btn-sm btn-ghost" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? "Chargement…" : `Charger plus (${formatNumber((total ?? 0) - files.length)} restants)`}
          </button>
        </div>
      )}
    </div>
  );
}