import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type {
  AppPreferences,
  LicenseActivationResult,
  LicenseCheckoutResult,
  LicenseInfo,
  Overview,
  ScanProgress,
  ScanResult,
  Toast,
} from "../../shared/types";
import { FREE_ENTITLEMENTS, PRO_FEATURES, type EntitlementKey, type ProFeatureDef } from "../../shared/monetization";
import { ProModal } from "../components/ProModal";

export type Page =
  | "dashboard"
  | "analyze"
  | "explorer"
  | "cleanup"
  | "large"
  | "old"
  | "downloads"
  | "categories"
  | "apps"
  | "games"
  | "duplicates"
  | "history"
  | "coach"
  | "guardian"
  | "automation"
  | "pro"
  | "guardianPro"
  | "forecasts"
  | "autoclean"
  | "settings";

export interface ScanState {
  active: boolean;
  progress: ScanProgress | null;
  lastResult: ScanResult | null;
}

interface AppCtx {
  overview: Overview | null;
  refreshOverview: () => Promise<void>;
  scanState: ScanState;
  setScanActive: (v: boolean) => void;
  setProgress: (p: ScanProgress | null) => void;
  setLastResult: (r: ScanResult | null) => void;
  page: Page;
  setPage: (p: Page) => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  prefs: AppPreferences | null;
  refreshPrefs: () => Promise<void>;
  version: string;
  license: LicenseInfo | null;
  refreshLicense: () => Promise<void>;
  /** Démarre l'essai Pro (une seule fois possible) puis rafraîchit l'état. */
  startTrial: () => Promise<LicenseInfo>;
  /** Active une clé de licence (Lemon Squeezy) via le main process. */
  activateLicense: (licenseKey: string) => Promise<LicenseActivationResult>;
  /** Restaure / revalide la licence déjà activée sur cette machine. */
  restoreLicense: () => Promise<LicenseActivationResult>;
  /** Ouvre le checkout officiel Lemon Squeezy dans le navigateur. */
  openCheckout: () => Promise<LicenseCheckoutResult>;
  /** Droit d'accès centralisé : true si la fonctionnalité est accessible. */
  can: (key: EntitlementKey) => boolean;
  /** Ouvre la modale Nova Pro pour la fonctionnalité donnée. */
  openPro: (key: EntitlementKey) => void;
  closePro: () => void;
  proFeature: ProFeatureDef | null;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [scanState, setScanState] = useState<ScanState>({ active: false, progress: null, lastResult: null });
  const [page, setPage] = useState<Page>("dashboard");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [prefs, setPrefs] = useState<AppPreferences | null>(null);
  const [version, setVersion] = useState("1.0.0");
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [proFeature, setProFeature] = useState<ProFeatureDef | null>(null);
  const toastId = useRef(0);

  const refreshOverview = useCallback(async () => {
    try {
      const o = await window.nova.getOverview();
      setOverview(o);
    } catch {
      /* silencieux */
    }
  }, []);

  const setScanActive = useCallback((v: boolean) => {
    setScanState((s) => ({ ...s, active: v }));
  }, []);

  const setProgress = useCallback((p: ScanProgress | null) => {
    setScanState((s) => ({ ...s, progress: p }));
  }, []);

  const setLastResult = useCallback((r: ScanResult | null) => {
    setScanState((s) => ({ ...s, lastResult: r }));
  }, []);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 5200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const refreshPrefs = useCallback(async () => {
    try {
      setPrefs(await window.nova.getPreferences());
    } catch {
      /* silencieux */
    }
  }, []);

  const refreshLicense = useCallback(async () => {
    try {
      setLicense(await window.nova.getLicenseInfo());
    } catch {
      /* silencieux : Free par défaut */
    }
  }, []);

  const startTrial = useCallback(async (): Promise<LicenseInfo> => {
    const info = await window.nova.startTrial();
    setLicense(info);
    return info;
  }, []);

  const activateLicense = useCallback(async (licenseKey: string): Promise<LicenseActivationResult> => {
    const result = await window.nova.activateLicense(licenseKey);
    setLicense(result.info);
    return result;
  }, []);

  const restoreLicense = useCallback(async (): Promise<LicenseActivationResult> => {
    const result = await window.nova.restoreLicense();
    setLicense(result.info);
    return result;
  }, []);

  const openCheckout = useCallback((): Promise<LicenseCheckoutResult> => window.nova.openCheckout(), []);

  const can = useCallback(
    (key: EntitlementKey): boolean => {
      if (FREE_ENTITLEMENTS.includes(key)) return true;
      return license?.isPro === true;
    },
    [license],
  );

  const openPro = useCallback((key: EntitlementKey) => {
    const def = PRO_FEATURES.find((f) => f.key === key);
    if (def) setProFeature(def);
  }, []);

  const closePro = useCallback(() => setProFeature(null), []);

  useEffect(() => {
    void refreshOverview();
    void window.nova.getVersion().then(setVersion);
    void refreshPrefs();
    void refreshLicense();
    void window.nova.getLastScanResult().then((r) => {
      if (r && r.status !== "cancelled") setScanState((s) => ({ ...s, lastResult: r }));
    });
  }, [refreshOverview, refreshPrefs, refreshLicense]);

  return (
    <Ctx.Provider
      value={{
        overview,
        refreshOverview,
        scanState,
        setScanActive,
        setProgress,
        setLastResult,
        page,
        setPage,
        toasts,
        pushToast,
        dismissToast,
        prefs,
        refreshPrefs,
        version,
        license,
        refreshLicense,
        startTrial,
        activateLicense,
        restoreLicense,
        openCheckout,
        can,
        openPro,
        closePro,
        proFeature,
      }}
    >
      {children}
      <ProModal />
    </Ctx.Provider>
  );
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp doit être utilisé dans AppProvider");
  return ctx;
}