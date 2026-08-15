import { useEffect, useMemo, useState } from "react";
import type { AppInfo, AppType } from "../../shared/types";
import { formatBytes } from "../../shared/types";
import { EmptyState, LoadingBar } from "../components/ui";
import { UninstallWizard } from "../components/UninstallWizard";

const TYPE_META: Record<AppType, { label: string; color: string; icon: string }> = {
  win32: { label: "Win32", color: "#3b82f6", icon: "▣" },
  msi: { label: "MSI", color: "#8b5cf6", icon: "▤" },
  msix: { label: "MSIX", color: "#06b6d4", icon: "▦" },
  store: { label: "Store", color: "#10b981", icon: "▧" },
  system: { label: "Système", color: "#ef4444", icon: "🛡️" },
  unknown: { label: "—", color: "#64748b", icon: "?" },
};

export function AppTypeBadge({ type }: { type: AppType }) {
  const m = TYPE_META[type] ?? TYPE_META.unknown;
  return (
    <span
      className="tag"
      title={m.label}
      style={{ color: m.color, borderColor: `${m.color}55`, background: `${m.color}14` }}
    >
      <span style={{ color: m.color }}>{m.icon}</span> {m.label}
    </span>
  );
}

function formatInstallDate(date: string): string {
  if (!date) return "—";
  if (/^\d{8}$/.test(date)) return `${date.slice(6, 8)}/${date.slice(4, 6)}/${date.slice(0, 4)}`;
  return date;
}

function formatLastUsed(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days < 30) return `il y a ${days} j`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  return `il y a ${Math.floor(months / 12)} an${Math.floor(months / 12) > 1 ? "s" : ""}`;
}

export function Apps() {
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hideProtected, setHideProtected] = useState(true);
  const [uninstall, setUninstall] = useState<{ app: AppInfo; mode: "simple" | "advanced" } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = () => {
    setApps(null);
    void window.nova
      .getApps()
      .then(setApps)
      .catch((e) => setError((e as Error).message));
  };

  useEffect(() => {
    load();
  }, []);

  const list = useMemo(() => {
    if (!apps) return [];
    const q = query.trim().toLowerCase();
    return apps
      .filter((a) => (hideProtected ? !a.protected : true))
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.publisher.toLowerCase().includes(q))
      .sort((a, b) => b.size - a.size);
  }, [apps, query, hideProtected]);

  if (error) {
    return <EmptyState icon="▧" title="Détection impossible" sub={error} />;
  }
  if (!apps) {
    return (
      <div className="loading-block-centered" style={{ maxWidth: 560, margin: "0 auto", paddingTop: 64 }}>
        <LoadingBar label="Lecture du registre Windows et des packages Store…" />
      </div>
    );
  }

  const withSize = apps.filter((a) => a.size > 0);
  const total = withSize.reduce((a, x) => a + x.size, 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Applications installées</h1>
          <p className="page-sub">
            Désinstallez proprement avec Nova : le désinstallateur officiel de l'éditeur est utilisé, puis les
            éventuels restes (fichiers, registre, services) sont proposés en quarantaine, jamais supprimés sans
            votre accord.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher…"
          />
          <button
            className="btn"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              void window.nova
                .refreshApps()
                .then(setApps)
                .catch((e) => setError((e as Error).message))
                .finally(() => setRefreshing(false));
            }}
          >
            ↻ Actualiser
          </button>
        </div>
      </div>

      <div className="row mb-4" style={{ gap: 10 }}>
        <span className="tag">🗂 {apps.length} applications détectées</span>
        <span className="tag">{formatBytes(total)} d'espace mesurable</span>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={hideProtected} onChange={(e) => setHideProtected(e.target.checked)} />{" "}
          Masquer les composants protégés
        </label>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Application</th>
              <th>Version</th>
              <th style={{ textAlign: "right" }}>Taille</th>
              <th>Type</th>
              <th>Installé le</th>
              <th>Dernière utilisation</th>
              <th className="sticky-actions" style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--text-muted)" }}>
                  Aucune application ne correspond à la recherche.
                </td>
              </tr>
            )}
            {list.map((a) => (
              <tr key={a.key || `${a.name}:${a.version}`} style={{ opacity: a.protected ? 0.75 : 1 }}>
                <td>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600 }}>
                      {a.protected && <span title={a.protectionReason}>🛡️ </span>}
                      {a.name}
                    </span>
                    <span className="path-cell muted">{a.publisher}</span>
                    {a.installLocation && (
                      <span className="path-cell" title={a.installLocation} style={{ maxWidth: 420 }}>{a.installLocation}</span>
                    )}
                    {a.protected && <span className="muted small">{a.protectionReason}</span>}
                  </div>
                </td>
                <td className="muted">{a.displayVersion || a.version || "—"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {a.size > 0 ? <b>{formatBytes(a.size)}</b> : <span className="muted">—</span>}
                </td>
                <td>
                  <AppTypeBadge type={a.type} />
                </td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatInstallDate(a.installDate)}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatLastUsed(a.lastUsed)}</td>
                <td className="sticky-actions" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={a.protected}
                      title={a.protected ? a.protectionReason : "Désinstallation rapide"}
                      onClick={() => setUninstall({ app: a, mode: "simple" })}
                    >
                      Désinstaller
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={a.protected}
                      title={a.protected ? a.protectionReason : "Analyse préalable et nettoyage des restes"}
                      onClick={() => setUninstall({ app: a, mode: "advanced" })}
                    >
                      Avancé
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {uninstall && (
        <UninstallWizard
          app={uninstall.app}
          mode={uninstall.mode}
          onClose={() => {
            setUninstall(null);
            void window.nova
              .refreshApps()
              .then(setApps)
              .catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}
