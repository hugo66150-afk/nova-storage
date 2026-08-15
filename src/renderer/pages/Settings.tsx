import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../state/store";
import type { AppPreferences, ExcludedItem } from "../../shared/types";
import { MONETIZATION, checkoutReady, formatPrice } from "../../shared/monetization";
import { ProBadge } from "../components/ProBadge";

export function Settings() {
  const { pushToast, version, refreshPrefs, can, openPro } = useApp();
  const [exclusions, setExclusions] = useState<ExcludedItem[]>([]);
  const [newPath, setNewPath] = useState("");
  const [prefs, setPrefs] = useState<AppPreferences | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.nova.getExclusions().then(setExclusions);
    void window.nova.getPreferences().then(setPrefs);
  }, []);

  const addExclusion = async () => {
    const path = newPath.trim();
    if (!path) return;
    if (path.startsWith(".")) {
      await window.nova.addExclusion({ path, kind: "extension" });
    } else {
      await window.nova.addExclusion({ path, kind: path.includes(".") && !path.endsWith("\\") ? "file" : "folder" });
    }
    setNewPath("");
    setExclusions(await window.nova.getExclusions());
    pushToast({ kind: "info", title: "Exclusion ajoutée", message: `${path} ne sera plus proposé au nettoyage.` });
  };

  const removeExclusion = async (id: number) => {
    await window.nova.removeExclusion(id);
    setExclusions(await window.nova.getExclusions());
  };

  const savePrefs = async () => {
    if (!prefs) return;
    await window.nova.savePreferences(prefs);
    await refreshPrefs();
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
    pushToast({ kind: "success", title: "Préférences enregistrées" });
  };

  const togglePref = (key: keyof AppPreferences) => {
    if (!prefs) return;
    setPrefs({ ...prefs, [key]: !prefs[key] });
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Paramètres</h1>
          <p className="page-sub">Exclusions, comportement de suppression et confidentialité. Nova est conçu local-first : aucune donnée ne quitte votre ordinateur.</p>
        </div>
      </div>

      <NovaProCard />

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div className="card">
          <h3>Suppression</h3>
          <ToggleRow
            label="Corbeille par défaut"
            hint="Envoyer à la corbeille Windows plutôt que de supprimer définitivement."
            value={prefs?.recycleByDefault ?? true}
            onChange={() => togglePref("recycleByDefault")}
          />
          <ToggleRow
            label="Confirmer les suppressions permanentes"
            hint="Afficher une confirmation renforcée pour toute suppression définitive."
            value={prefs?.confirmPermanentDelete ?? true}
            onChange={() => togglePref("confirmPermanentDelete")}
          />
          <ToggleRow
            label="Confirmer le nettoyage des temporaires"
            hint="Demander confirmation avant de nettoyer les fichiers temporaires."
            value={prefs?.tempCleanupRequiresConfirm ?? true}
            onChange={() => togglePref("tempCleanupRequiresConfirm")}
          />
          <ToggleRow
            label="Analyser au démarrage"
            hint="Lancer automatiquement une analyse complète au lancement de l'application."
            value={prefs?.scanOnStartup ?? false}
            onChange={() => togglePref("scanOnStartup")}
          />
          <div className="row mt-4" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={() => void savePrefs()}>{saved ? "✓ Enregistré" : "Enregistrer"}</button>
          </div>
        </div>

        <div className="card">
          <h3>Rétention des données</h3>
          <div className="card-sub">La base locale conserve les dernières analyses. Les détails de fichiers sont agrégés et purgés selon ces limites.</div>
          <div className="row mt-4" style={{ gap: 16 }}>
            <label className="small muted" style={{ flex: 1 }}>
              Analyses conservées
              <input
                className="input mt-2"
                type="number"
                min={1}
                max={20}
                value={prefs?.retentionScans ?? 5}
                onChange={(e) => prefs && setPrefs({ ...prefs, retentionScans: Number(e.target.value) })}
              />
            </label>
            <label className="small muted" style={{ flex: 1 }}>
              Jours de conservation
              <input
                className="input mt-2"
                type="number"
                min={7}
                max={365}
                value={prefs?.retentionDays ?? 30}
                onChange={(e) => prefs && setPrefs({ ...prefs, retentionDays: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="row mt-4" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={() => void savePrefs()}>Enregistrer</button>
          </div>
        </div>
      </div>

      <div className="card mt-5">
        <h3>Gardien du stockage</h3>
        <div className="card-sub">
          Le Gardien surveille vos disques en arrière-plan — même application fermée — et vous alerte via les
          notifications Windows avant que l'espace ne manque. Il reste toujours désactivable.
        </div>
        <ToggleRow
          label="Activer le Gardien"
          hint="Surveillance en arrière-plan : seuils, prédictions et résumé hebdomadaire."
          value={prefs?.guardianEnabled ?? false}
          onChange={() => togglePref("guardianEnabled")}
        />
        <ToggleRow
          label="Notifications Windows"
          hint="Recevoir des alertes natives lorsque vos disques approchent des seuils."
          value={prefs?.guardianNotifications ?? true}
          onChange={() => togglePref("guardianNotifications")}
        />
        <ToggleRow
          label={<span className="row" style={{ gap: 8 }}>Prévisions de remplissage <ProBadge /></span>}
          hint="Estimer le délai avant saturation à partir de l'historique réel de Nova."
          value={prefs?.guardianPredictions ?? true}
          onChange={() => {
            if (!can("guardianPredictions")) {
              openPro("guardianPredictions");
              return;
            }
            togglePref("guardianPredictions");
          }}
        />
        <ToggleRow
          label="Résumé hebdomadaire"
          hint="Un récapitulatif sobre de l'évolution de votre stockage chaque semaine."
          value={prefs?.guardianWeekly ?? true}
          onChange={() => togglePref("guardianWeekly")}
        />

        <div className="row mt-4" style={{ gap: 16, flexWrap: "wrap" }}>
          <label className="small muted" style={{ flex: 1, minWidth: 150 }}>
            Seuil d'alerte basse (%)
            <input
              className="input mt-2"
              type="number"
              min={50}
              max={99}
              value={prefs?.guardianWarnPct ?? 80}
              onChange={(e) => prefs && setPrefs({ ...prefs, guardianWarnPct: Number(e.target.value) })}
            />
          </label>
          <label className="small muted" style={{ flex: 1, minWidth: 150 }}>
            Seuil d'alerte haute (%)
            <input
              className="input mt-2"
              type="number"
              min={51}
              max={99}
              value={prefs?.guardianAlertPct ?? 90}
              onChange={(e) => prefs && setPrefs({ ...prefs, guardianAlertPct: Number(e.target.value) })}
            />
          </label>
          <label className="small muted" style={{ flex: 1, minWidth: 150 }}>
            Seuil critique (%)
            <input
              className="input mt-2"
              type="number"
              min={52}
              max={100}
              value={prefs?.guardianCriticalPct ?? 95}
              onChange={(e) => prefs && setPrefs({ ...prefs, guardianCriticalPct: Number(e.target.value) })}
            />
          </label>
          <label className="small muted" style={{ flex: 1, minWidth: 150 }}>
            Fréquence de vérification (minutes)
            <input
              className="input mt-2"
              type="number"
              min={5}
              max={1440}
              value={prefs?.guardianFrequencyMin ?? 60}
              onChange={(e) => prefs && setPrefs({ ...prefs, guardianFrequencyMin: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="row mt-4" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-primary" onClick={() => void savePrefs()}>Enregistrer</button>
        </div>
      </div>

      <div className="card mt-5">
        <h3>Exclusions</h3>
        <div className="card-sub">
          Fichiers, dossiers ou extensions que Nova ne doit jamais proposer au nettoyage. L'espace occupé reste
          affiché, mais aucune action de nettoyage n'est suggérée.
        </div>
        <div className="row" style={{ gap: 10 }}>
          <input
            className="input flex-1"
            placeholder="Exemple : D:\Mes Projets · C:\Users\…\downloads · ou .backup"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addExclusion()}
          />
          <button className="btn" onClick={() => void addExclusion()}>+ Ajouter</button>
        </div>

        <div className="table-wrap mt-4">
          {exclusions.length === 0 && <div className="muted small" style={{ padding: 16 }}>Aucune exclusion définie.</div>}
          {exclusions.map((e) => (
            <div key={e.id} className="file-row">
              <span className="tag">{e.kind === "extension" ? ".ext" : e.kind === "folder" ? "📁" : "📄"}</span>
              <span className="file-name mono">{e.path}</span>
              <button className="icon-btn danger" onClick={() => void removeExclusion(e.id)}>✕</button>
            </div>
          ))}
        </div>
      </div>

      <div className="card mt-5">
        <h3>Confidentialité</h3>
        <div className="modal-note" style={{ marginTop: 8 }}>
          <strong>Nova fonctionne entièrement hors ligne.</strong> Les noms, chemins, tailles et contenus de fichiers
          restent sur cet ordinateur. L'application ne téléverse ni ne partage aucune donnée. Aucune connexion
          Internet n'est nécessaire pour analyser, classer ou nettoyer votre stockage.
        </div>
        <div className="insight positive mt-4">
          <span className="insight-ico">🔒</span>
          <div>
            <div className="insight-title">Application local-first</div>
            <p className="insight-msg">Les données sont stockées dans une base locale chiffrée par le système (profil utilisateur).</p>
          </div>
        </div>
      </div>

      <div className="mt-5 faint small" style={{ textAlign: "center", padding: 10 }}>
        Nova Storage v{version} · Fait pour comprendre votre stockage, sans jamais nettoyer à l'aveugle.
      </div>
    </div>
  );
}

function NovaProCard() {
  const { license, openPro, activateLicense, restoreLicense, openCheckout, pushToast } = useApp();
  const [licenseKey, setLicenseKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "info"; message: string } | null>(null);
  if (!license) return null;
  const price = formatPrice(MONETIZATION.pricing.proPrice, MONETIZATION.pricing.currency);
  const checkout = checkoutReady();

  const isPro = license.status === "pro";
  const isTrial = license.status === "trial_pro";

  const freeNote = () => {
    switch (license.status) {
      case "license_revoked":
        return "Cette licence a été révoquée. Nova Free reste disponible.";
      case "license_invalid":
        return "Cette licence n'est plus valide. Nova Free reste disponible.";
      case "trial_expired":
        return "Votre essai Nova Pro est terminé — Nova Free reste disponible gratuitement.";
      default:
        return "Gratuit pour toujours : analyse complète, nettoyage manuel, Coach, Gardien essentiel. Nova Pro automatise votre nettoyage et fait gagner du temps.";
    }
  };

  const doActivate = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await activateLicense(licenseKey);
      setNotice({ kind: result.ok ? "ok" : "error", message: result.message });
      if (result.ok) setLicenseKey("");
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await restoreLicense();
      setNotice({ kind: result.ok ? "ok" : "info", message: result.message });
    } finally {
      setBusy(false);
    }
  };

  const doBuy = async () => {
    if (!checkout) {
      pushToast({ kind: "info", title: "Nova Pro", message: "Le paiement sera bientôt disponible." });
      return;
    }
    await openCheckout();
  };

  return (
    <div className="card mt-5" style={{ borderColor: "rgba(242, 182, 60, 0.35)" }}>
      <div className="row-between" style={{ flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Nova Pro</h3>
            <ProBadge />
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {!license.isPro && !license.trialUsed && (
            <button className="btn btn-pro" onClick={() => openPro("automation")}>
              Commencer l'essai gratuit
            </button>
          )}
          {!license.isPro && (
            <button
              className="btn"
              onClick={() => void doBuy()}
              disabled={!checkout}
              title={checkout ? "Acheter Nova Pro" : "Le paiement sera bientôt disponible"}
            >
              Acheter Nova Pro · {price}
            </button>
          )}
        </div>
      </div>

      <div className={`pro-status ${isPro ? "is-pro" : isTrial ? "is-trial" : "is-free"}`}>
        <div className="pro-status-head">
          <span className="pro-status-ico">{isPro ? "✨" : isTrial ? "⏳" : "🆓"}</span>
          <span>{isPro ? "Nova Pro actif" : isTrial ? "Essai Nova Pro" : "Nova Storage Free"}</span>
          {isTrial && (
            <span className="pro-status-days">
              {license.trialDaysLeft} jour{license.trialDaysLeft > 1 ? "s" : ""} restants
            </span>
          )}
        </div>
        {isPro ? (
          <div className="pro-status-grid">
            <div className="pro-status-cell"><span className="muted small">Statut</span><strong>Actif</strong></div>
            <div className="pro-status-cell"><span className="muted small">Type</span><strong>Licence Nova Pro</strong></div>
            {license.licenseKeyHint && (
              <div className="pro-status-cell"><span className="muted small">Licence</span><strong className="mono">{license.licenseKeyHint}</strong></div>
            )}
            {license.activatedAt && (
              <div className="pro-status-cell"><span className="muted small">Activée le</span><strong>{new Date(license.activatedAt).toLocaleDateString("fr-FR")}</strong></div>
            )}
            {license.lastValidatedAt && (
              <div className="pro-status-cell"><span className="muted small">Dernière validation</span><strong>{new Date(license.lastValidatedAt).toLocaleDateString("fr-FR")}</strong></div>
            )}
          </div>
        ) : isTrial ? (
          <p className="pro-status-note">
            Accès complet à toutes les fonctionnalités Pro pendant l'essai. Après {license.trialDaysLeft > 1 ? "ces" : "ce"} {license.trialDaysLeft} jour{license.trialDaysLeft > 1 ? "s" : ""}, retour automatique à Nova Free — sans perte de données ni de règles.
          </p>
        ) : (
          <p className="pro-status-note">{freeNote()}</p>
        )}
      </div>

      <div className="pro-price mt-4">
        {price}
        <span className="muted small"> · achat unique, sans abonnement · TTC</span>
      </div>

      <div className="mt-4">
        <label className="small muted" htmlFor="license-key-input">
          Activer une licence
        </label>
        <div className="row mt-2" style={{ gap: 10 }}>
          <input
            id="license-key-input"
            className="input flex-1"
            placeholder="Votre clé de licence Lemon Squeezy"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void doActivate()}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn" onClick={() => void doActivate()} disabled={busy || !licenseKey.trim()}>
            {busy ? "Activation…" : "Activer Nova Pro"}
          </button>
          <button className="btn" onClick={() => void doRestore()} disabled={busy}>
            Restaurer ma licence
          </button>
        </div>
        {notice && (
          <div className={`xs mt-2 ${notice.kind === "error" ? "danger" : notice.kind === "ok" ? "good" : "muted"}`}>
            {notice.message}
          </div>
        )}
        {license.isPro && license.licenseKeyHint && (
          <div className="xs muted mt-2">Licence activée : {license.licenseKeyHint}</div>
        )}
      </div>

      <div className="xs muted mt-3">
        Fonctionnalités Pro : automatisation par règles, maintenance planifiée, Gardien avancé, prévisions de remplissage.
        Tout le reste de Nova reste gratuit pour toujours. Paiement sécurisé via Lemon Squeezy, aucune donnée bancaire ne transite par l'application.
      </div>
    </div>
  );
}

function ToggleRow({ label, hint, value, onChange }: { label: ReactNode; hint: string; value: boolean; onChange: () => void }) {
  return (
    <div className="row-between" style={{ padding: "12px 0" }}>
      <div>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="small muted">{hint}</div>
      </div>
      <button
        className="checkbox"
        style={{ background: value ? "var(--accent-gradient)" : "rgba(255,255,255,0.06)", borderColor: "transparent", width: 44, height: 24, borderRadius: 20, display: "grid", placeItems: value ? "center right" : "center left", padding: 3, transition: "all 0.2s" }}
        onClick={onChange}
        aria-pressed={value}
      >
        <span style={{ width: 18, height: 18, borderRadius: 50, background: "#fff", display: "block", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
      </button>
    </div>
  );
}
