import { useEffect, useMemo } from "react";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { ToastHost } from "./components/ToastHost";
import { useApp } from "./state/store";
import { Dashboard } from "./pages/Dashboard";
import { Analyze } from "./pages/Analyze";
import { Explorer } from "./pages/Explorer";
import { Cleanup } from "./pages/Cleanup";
import { LargeFiles } from "./pages/LargeFiles";
import { OldFiles } from "./pages/OldFiles";
import { Downloads } from "./pages/Downloads";
import { Categories } from "./pages/Categories";
import { Apps } from "./pages/Apps";
import { Games } from "./pages/Games";
import { Duplicates } from "./pages/Duplicates";
import { HistoryPage } from "./pages/History";
import { Coach } from "./pages/Coach";
import { GuardianPage } from "./pages/Guardian";
import { AutomationPage } from "./pages/Automation";
import { ProHub } from "./pages/ProHub";
import { AutoCleanPage } from "./pages/AutoClean";
import { GuardianProPage } from "./pages/GuardianPro";
import { ForecastsPage } from "./pages/Forecasts";
import { Settings } from "./pages/Settings";

export function App() {
  const { page, setPage, setScanActive, setProgress, setLastResult, refreshOverview, pushToast } = useApp();

  useEffect(() => {
    const offProgress = window.nova.onScanProgress((p) => {
      setProgress(p);
      setScanActive(true);
    });
    const offFinished = window.nova.onScanFinished((r) => {
      setProgress(null);
      setScanActive(false);
      setLastResult(r);
      void refreshOverview();
      pushToast({
        kind: r.status === "cancelled" ? "info" : "success",
        title: r.status === "cancelled" ? "Analyse annulée" : "Analyse terminée",
        message:
          r.status === "cancelled"
            ? "Aucune donnée enregistrée."
            : `${(r.totalBytes / 1024 ** 3).toFixed(2)} Go analysés · ${r.totalFiles.toLocaleString("fr-FR")} fichiers`,
      });
    });
    const offError = window.nova.onScanError((e) => {
      setProgress(null);
      setScanActive(false);
      pushToast({ kind: "error", title: "Échec de l'analyse", message: e.message });
    });
    const offNav = window.nova.onGuardianNavigate((p) => {
      if (p === "dashboard" || p === "analyze" || p === "cleanup" || p === "coach" || p === "guardian" || p === "settings" || p === "apps" || p === "games" || p === "history" || p === "pro" || p === "autoclean" || p === "guardianPro" || p === "forecasts" || p === "automation") {
        setPage(p);
      }
    });
    return () => {
      offProgress();
      offFinished();
      offError();
      offNav();
    };
  }, [setProgress, setScanActive, setLastResult, refreshOverview, pushToast, setPage]);

  const pageEl = useMemo(() => {
    switch (page) {
      case "dashboard":
        return <Dashboard />;
      case "analyze":
        return <Analyze />;
      case "explorer":
        return <Explorer />;
      case "cleanup":
        return <Cleanup />;
      case "large":
        return <LargeFiles />;
      case "old":
        return <OldFiles />;
      case "downloads":
        return <Downloads />;
      case "categories":
        return <Categories />;
      case "apps":
        return <Apps />;
      case "games":
        return <Games />;
      case "duplicates":
        return <Duplicates />;
      case "history":
        return <HistoryPage />;
      case "coach":
        return <Coach />;
      case "guardian":
        return <GuardianPage />;
      case "automation":
        return <AutomationPage />;
      case "pro":
        return <ProHub />;
      case "autoclean":
        return <AutoCleanPage />;
      case "guardianPro":
        return <GuardianProPage />;
      case "forecasts":
        return <ForecastsPage />;
      case "settings":
        return <Settings />;
    }
  }, [page]);

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <main className="app-main" key={page} style={{ animation: "riseIn 0.4s cubic-bezier(0.22,1,0.36,1)" }}>
          {pageEl}
        </main>
      </div>
      <ToastHost />
    </div>
  );
}

export type { Page } from "./state/store";