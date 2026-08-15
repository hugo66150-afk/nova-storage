import { useApp, type Page } from "../state/store";
import { ProBadge } from "./ProBadge";

const NAV: Array<{ section: string; items: Array<{ page: Page; label: string; icon: string; pro?: boolean }> }> = [
  {
    section: "Vue d'ensemble",
    items: [
      { page: "dashboard", label: "Tableau de bord", icon: "🏠" },
      { page: "analyze", label: "Analyser", icon: "🔍" },
    ],
  },
  {
    section: "Nova IA",
    items: [
      { page: "coach", label: "Nova Coach", icon: "🧠" },
      { page: "guardian", label: "Gardien", icon: "👁️" },
    ],
  },
  {
    // Catégorie dédiée Nova Pro : visible immédiatement, même pour les
    // utilisateurs Free — chaque entrée porte un badge PRO doré.
    section: "Nova Pro ✦",
    items: [
      { page: "pro", label: "Nova Pro", icon: "✦", pro: true },
      { page: "autoclean", label: "AutoClean", icon: "🪄", pro: true },
      { page: "automation", label: "Automatisation", icon: "⚙️", pro: true },
      { page: "guardianPro", label: "Gardien Pro", icon: "🛡️", pro: true },
      { page: "forecasts", label: "Prévisions", icon: "📈", pro: true },
    ],
  },
  {
    section: "Explorer",
    items: [
      { page: "explorer", label: "Explorateur", icon: "📁" },
      { page: "categories", label: "Catégories", icon: "🗂️" },
      { page: "large", label: "Gros fichiers", icon: "🐘" },
      { page: "old", label: "Fichiers anciens", icon: "⏳" },
      { page: "downloads", label: "Téléchargements", icon: "📥" },
      { page: "duplicates", label: "Doublons", icon: "📑" },
    ],
  },
  {
    section: "Nettoyage",
    items: [{ page: "cleanup", label: "Libérer de l'espace", icon: "🧹" }],
  },
  {
    section: "Applications",
    items: [
      { page: "apps", label: "Applications", icon: "💻" },
      { page: "games", label: "Jeux", icon: "🎮" },
    ],
  },
  {
    section: "Suivi",
    items: [{ page: "history", label: "Historique", icon: "🕘" }],
  },
  {
    section: "Système",
    items: [{ page: "settings", label: "Paramètres", icon: "⚙️" }],
  },
];

export function Sidebar() {
  const { page, setPage, scanState, overview } = useApp();
  const recoverableGo = (overview?.recoverable.totalBytes ?? 0) / 1024 ** 3;

  return (
    <nav className={`sidebar ${page === "pro" ? "pro-page-active" : ""}`} aria-label="Navigation principale">
      {NAV.map((group) => (
        <div key={group.section}>
          <div className={`sidebar-section-label ${group.section.startsWith("Nova Pro") ? "pro-section-label" : ""}`}>
            {group.section.startsWith("Nova Pro") ? <span className="pro-section-star">✦</span> : null}
            {group.section.startsWith("Nova Pro") ? "Nova Pro" : group.section}
          </div>
          {group.items.map((item) => (
            <button
              key={item.page}
              className={`nav-item ${item.pro ? "nav-pro" : ""} ${page === item.page ? "active" : ""}`}
              onClick={() => setPage(item.page)}
            >
              <span className="nav-ico">{item.icon}</span>
              {item.label}
              {item.pro && <ProBadge />}
              {item.page === "cleanup" && recoverableGo >= 1 && (
                <span className="nav-badge">{recoverableGo.toFixed(1)} Go</span>
              )}
              {item.page === "analyze" && scanState.active && <span className="nav-badge pulse">●</span>}
            </button>
          ))}
        </div>
      ))}
      <div className="sidebar-footer">
        <span>🔒 Local-first · vos données restent sur cet ordinateur</span>
        <span>Nova Storage v{useVersion()}</span>
      </div>
    </nav>
  );
}

function useVersion(): string {
  const { version } = useApp();
  return version;
}
