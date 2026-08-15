export type Category =
  | "system"
  | "apps"
  | "games"
  | "documents"
  | "images"
  | "videos"
  | "audio"
  | "archives"
  | "downloads"
  | "temp"
  | "caches"
  | "backups"
  | "other";

export const CATEGORIES: Category[] = [
  "system",
  "apps",
  "games",
  "documents",
  "images",
  "videos",
  "audio",
  "archives",
  "downloads",
  "temp",
  "caches",
  "backups",
  "other",
];

export const CATEGORY_LABELS: Record<Category, string> = {
  system: "Système Windows",
  apps: "Applications",
  games: "Jeux",
  documents: "Documents",
  images: "Images",
  videos: "Vidéos",
  audio: "Audio",
  archives: "Archives",
  downloads: "Téléchargements",
  temp: "Temporaires",
  caches: "Caches",
  backups: "Sauvegardes",
  other: "Autres",
};

export const CATEGORY_ICONS: Record<Category, string> = {
  system: "🛡️",
  apps: "🟣",
  games: "🎮",
  documents: "📄",
  images: "🖼️",
  videos: "🎬",
  audio: "🎵",
  archives: "📦",
  downloads: "📥",
  temp: "🧹",
  caches: "🗄️",
  backups: "💾",
  other: "❔",
};

export const CATEGORY_COLORS: Record<Category, string> = {
  system: "#64748b",
  apps: "#a855f7",
  games: "#f59e0b",
  documents: "#3b82f6",
  images: "#22c55e",
  videos: "#ef4444",
  audio: "#e879f9",
  archives: "#14b8a6",
  downloads: "#06b6d4",
  temp: "#84cc16",
  caches: "#8b5cf6",
  backups: "#0ea5e9",
  other: "#94a3b8",
};

export type SafetyLevel =
  | "safe"
  | "review"
  | "caution"
  | "risky"
  | "protected";

export const SAFETY_LABELS: Record<SafetyLevel, string> = {
  safe: "Sûr",
  review: "À examiner",
  caution: "Attention",
  risky: "Risqué",
  protected: "Protégé",
};

export const SAFETY_ICONS: Record<SafetyLevel, string> = {
  safe: "🟢",
  review: "🟡",
  caution: "🟠",
  risky: "🔴",
  protected: "🛡️",
};

export type CandidateKind =
  | "temp"
  | "cache"
  | "recyclebin"
  | "large"
  | "old"
  | "download"
  | "archive"
  | "duplicate"
  | "logs"
  | "crash"
  | "thumbnail";

export interface FileCandidate {
  id: string;
  path: string;
  name: string;
  extension: string;
  size: number;
  created: number;
  modified: number;
  isDir: boolean;
  category: Category;
  safety: SafetyLevel;
  confidence: number;
  reasons: string[];
  kind: CandidateKind;
  sourceScanId: number;
}

/** Page de résultats de fichiers issue d'une requête SQL paginée. */
export interface PagedFiles {
  items: FileCandidate[];
  total: number;
  totalBytes: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface CategoryAggregate {
  category: Category;
  bytes: number;
  files: number;
}

export interface DirEntry {
  path: string;
  name: string;
  size: number;
  fileCount: number;
  dirCount: number;
  category: Category;
  safety: SafetyLevel;
}

export interface DirChildrenResult {
  path: string;
  parentPath: string | null;
  dirs: DirEntry[];
  files: FileCandidate[];
  totalSize: number;
  totalFiles: number;
  totalDirs: number;
}

export interface ScanError {
  path: string;
  code: string;
  message: string;
}

export type ScanStatus = "running" | "paused" | "completed" | "cancelled" | "error";

export interface ScanProgress {
  status: ScanStatus;
  percent: number;
  currentPath: string;
  filesAnalyzed: number;
  dirsAnalyzed: number;
  bytesAnalyzed: number;
  errors: number;
  elapsedMs: number;
  etaMs: number | null;
  target: string;
}

export interface DriveInfo {
  name: string;
  label: string;
  filesystem: string;
  total: number;
  free: number;
  used: number;
}

export interface ScanTarget {
  kind: "drive" | "folder" | "multi";
  paths: string[];
}

export interface ScanResult {
  scanId: number;
  target: string;
  root: string;
  status: "completed" | "cancelled" | "partial" | "error";
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  totalFiles: number;
  totalDirs: number;
  totalBytes: number;
  errors: ScanError[];
  categories: CategoryAggregate[];
  recoverable: RecoverableSummary;
}

export interface RecoverableSummary {
  totalBytes: number;
  byKind: Record<CandidateKind, number>;
  groups: RecommendationGroup[];
}

export interface RecommendationGroup {
  key: CandidateKind;
  title: string;
  description: string;
  risk: SafetyLevel;
  confidence: number;
  bytes: number;
  files: number;
}

export interface CleanupRequest {
  kind: CandidateKind;
  paths: string[];
  mode: "recycle" | "permanent";
}

export interface CleanupItemResult {
  path: string;
  status: "deleted" | "recycled" | "locked" | "missing" | "protected" | "error";
  bytes: number;
  error?: string;
}

export interface CleanupResult {
  kind: CandidateKind;
  mode: "recycle" | "permanent";
  requested: number;
  succeeded: number;
  bytesFreed: number;
  bytesRequested: number;
  items: CleanupItemResult[];
}

export type AppType = "win32" | "msi" | "msix" | "store" | "system" | "unknown";

export interface AppInfo {
  name: string;
  publisher: string;
  version: string;
  installLocation: string;
  estimatedSize: number;
  installDate: string;
  size: number;
  files: number;
  key: string;
  type: AppType;
  protected: boolean;
  protectionReason: string;
  uninstallString: string;
  quietUninstallString: string;
  displayIcon: string;
  registryPath: string;
  displayVersion: string;
  lastUsed: number | null;
  modifyPath?: string;
  packageFamilyName?: string;
  packageFullName?: string;
  installSource?: string;
}

/** Répartition des tailles identifiées avant désinstallation. */
export interface UninstallBreakdown {
  install: number;
  userData: number;
  programData: number;
  cache: number;
  other: number;
}

export interface UninstallReferenceItem {
  kind: "file" | "folder" | "registry" | "service" | "task" | "startup";
  path: string;
  size: number;
  label: string;
  confidence: "certain" | "likely" | "examine" | "uncertain";
  shared?: boolean;
}

export interface UninstallAnalysis {
  sessionId: string;
  appKey: string;
  appName: string;
  breakdown: UninstallBreakdown;
  totalBytes: number;
  items: UninstallReferenceItem[];
  uninstaller: {
    type: AppType;
    command: string;
    silentCommand: string;
    msiexecProductCode: string;
  };
  createdAt: number;
}

export type RemainConfidence = "certain" | "likely" | "examine" | "uncertain" | "protected";

export interface UninstallRemain {
  id: string;
  kind: "file" | "folder" | "registry" | "service" | "task" | "startup";
  path: string;
  label: string;
  size: number;
  confidence: RemainConfidence;
  shared: boolean;
  note: string;
  exists: boolean;
}

export type UninstallStatus = "success" | "alreadyGone" | "cancelled" | "failed" | "pending" | "restartRequired";

export interface UninstallRunResult {
  sessionId: string;
  status: UninstallStatus;
  message: string;
  returnedCode: number | null;
  elapsedMs: number;
}

export interface CleanRemainsResult {
  sessionId: string;
  moved: number;
  bytesQuarantined: number;
  registryExported: number;
  /** Nombre total d'éléments réellement nettoyés (fichiers + registre + services + tâches). */
  handled: number;
  /** Nombre d'éléments dont le nettoyage a échoué (permissions, etc.). */
  failed: number;
  items: UninstallRemain[];
}

export interface RestoreResult {
  restored: number;
  failed: number;
  items: string[];
}

/** État progressif d'une opération de désinstallation (broadcast). */
export interface UninstallProgress {
  sessionId: string;
  phase:
    | "pre-analyze"
    | "uninstalling"
    | "remains"
    | "cleaning"
    | "restoring"
    | "verify"
    | "done"
    | "error";
  label: string;
  detail?: string;
  percent: number;
}

export interface GameInfo {
  name: string;
  path: string;
  library: "Steam" | "Epic" | "Battle.net" | "GOG" | "Xbox" | "Riot" | "Other";
  size: number;
  files: number;
}

export interface DuplicateGroup {
  id: string;
  size: number;
  hash: string;
  files: FileCandidate[];
  totalBytes: number;
}

export interface HistoryEvent {
  id: number;
  at: number;
  type: "scan" | "cleanup";
  status: string;
  totalBytes: number;
  freedBytes: number;
  detail: string;
}

export interface Insight {
  kind: "warning" | "info" | "positive";
  title: string;
  message: string;
}

export interface ScanSettings {
  mode: "quick" | "full" | "custom";
  targets: ScanTarget | null;
}

export interface DiskSnapshot {
  at: number;
  total: number;
  free: number;
  used: number;
}

export interface StorageTrend {
  points: DiskSnapshot[];
  weeklyGrowth: number;
}

export interface RecommendationDetail {
  group: RecommendationGroup;
  samples: FileCandidate[];
  /** Nombre total de fichiers du groupe (toutes pages confondues). */
  total: number;
  /** Taille totale du groupe (toutes pages confondues). */
  totalBytes: number;
  hasMore: boolean;
}

export interface AppPreferences {
  recycleByDefault: boolean;
  tempCleanupRequiresConfirm: boolean;
  retentionScans: number;
  retentionDays: number;
  scanOnStartup: boolean;
  confirmPermanentDelete: boolean;
  guardianEnabled: boolean;
  guardianNotifications: boolean;
  guardianPredictions: boolean;
  guardianWeekly: boolean;
  guardianWarnPct: number;
  guardianAlertPct: number;
  guardianCriticalPct: number;
  guardianFrequencyMin: number;
  guardianDrives: string[];
}

/* ---------------- NOVA COACH ---------------- */

export type CoachKind =
  | CandidateKind
  | "apps-unused"
  | "games-large"
  | "growth"
  | "prediction"
  | "recent-download";

export interface CoachRecommendation {
  key: string;
  kind: CoachKind;
  title: string;
  explanation: string;
  reason: string;
  bytes: number;
  files: number;
  risk: SafetyLevel;
  confidence: number;
  /** Cible de navigation pour le bouton d'action. */
  action: "cleanup" | "apps" | "games" | "history" | "analyze";
  /** Groupe de nettoyage concerné (si action === "cleanup"). */
  targetKind?: CandidateKind;
  /** Pourcentage du récupérable total représenté par cette recommandation. */
  share: number;
}

export interface CoachReport {
  status: "healthy" | "attention";
  headline: string;
  sub: string;
  totalRecoverable: number;
  recommendations: CoachRecommendation[];
  protectedNote: string | null;
  generatedAt: number;
}

/* ---------------- GARDIEN DU STOCKAGE ---------------- */

export interface GuardianDriveStatus {
  name: string;
  label: string;
  total: number;
  used: number;
  free: number;
  pct: number;
  level: "ok" | "warn" | "alert" | "critical";
}

export interface GuardianPrediction {
  at: number;
  ratePerDay: number;
  daysToFull: number | null;
  fullAt: number | null;
  reliable: boolean;
  message: string;
}

export interface GuardianEvent {
  id: number;
  at: number;
  drive: string;
  level: "ok" | "warn" | "alert" | "critical" | "info";
  message: string;
}

export interface GuardianForecastThreshold {
  /** Seuil en % (ex. 90). */
  pct: number;
  /** Date estimée de franchissement du seuil (null si non prévisible). */
  at: number | null;
}

export interface GuardianForecast {
  /** Dates estimées de franchissement des seuils d'alerte configurés. */
  thresholds: GuardianForecastThreshold[];
  /** Date estimée de saturation complète (null si non prévisible). */
  fullAt: number | null;
  /** Nombre de points de mesure utilisés. */
  dataPoints: number;
  /** Durée couverte par les mesures (jours). */
  spanDays: number;
  reliable: boolean;
}

export interface GuardianReport {
  enabled: boolean;
  drives: GuardianDriveStatus[];
  prediction: GuardianPrediction | null;
  /** Prévisions avancées (Gardien avancé — Nova Pro). */
  forecast: GuardianForecast | null;
  events: GuardianEvent[];
  lastCheckAt: number | null;
  weeklyGrowth: number;
}

/* ---------------- AUTOMATISATION PAR RÈGLES ---------------- */

export type ConditionField =
  | "kind"
  | "category"
  | "size"
  | "ageDays"
  | "path"
  | "extension"
  | "drive"
  | "safety"
  | "lastScanId";

export type ConditionOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "matches";

export interface RuleCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value: string | number | string[] | number[];
}

export interface RuleConditionGroup {
  operator: "AND" | "OR";
  conditions: RuleCondition[];
  /** Sous-groupes (ex. règles internes AutoClean) — évalués en mémoire. */
  groups?: RuleConditionGroup[];
}

export type ActionType =
  | "moveToQuarantine"
  | "moveToFolder"
  | "deleteToRecycleBin"
  | "deletePermanent"
  | "notify"
  | "logOnly";

export interface RuleAction {
  type: ActionType;
  /** Dossier cible pour moveToFolder */
  targetPath?: string;
  /** Message pour notify */
  message?: string;
}

export interface AutomationRule {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  /** Condition racine : AND/OR imbriqués */
  condition: RuleConditionGroup;
  /** Actions à exécuter si la condition est vraie */
  actions: RuleAction[];
  /** Planification : "manual" | "hourly" | "daily" | "weekly" | "monthly" */
  schedule: "manual" | "hourly" | "daily" | "weekly" | "monthly";
  /** Heure pour daily/weekly/monthly (ex: "02:00") */
  scheduleTime?: string;
  /** Jour pour weekly (0-6, 0=dimanche) ou monthly (1-31) */
  scheduleDay?: number;
  /** Dernière exécution */
  lastRunAt: number | null;
  /** Nombre d'exécutions */
  runCount: number;
  createdAt: number;
  updatedAt: number;
}

export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "dry-run";

export interface RuleExecution {
  id: number;
  ruleId: number;
  ruleName: string;
  status: ExecutionStatus;
  startedAt: number;
  finishedAt: number | null;
  /** Résultat du dry-run : candidats qui auraient été affectés */
  dryRunCandidates: Array<{ path: string; size: number; kind: string }>;
  /** Candidats réellement traités (après confirmation) */
  executedCandidates: Array<{ path: string; size: number; action: string; result: "ok" | "error"; error?: string }>;
  bytesAffected: number;
  filesAffected: number;
  error?: string;
}

export interface DryRunResult {
  ruleId: number;
  ruleName: string;
  candidates: Array<{ path: string; size: number; kind: string; category: string }>;
  totalBytes: number;
  totalFiles: number;
  /** Avertissements de sécurité affichés avant exécution (jamais bloquants). */
  warnings?: string[];
}

/* ---------------- NOVA AUTOCLEAN (Nova Pro) ---------------- */

/** Déclencheurs de Nova AutoClean. */
export type AutoCleanTrigger = "daily" | "weekly" | "startup" | "disk";

/** Opérations automatiques réellement supportées par le moteur de règles. */
export type AutoCleanActionType = "temp" | "oldDownloads" | "largeFiles";

/**
 * Configuration Nova AutoClean — stockée dans les préférences (JSON), seule
 * source de vérité du service autoclean côté MAIN. Aucune logique d'exécution
 * ici : les helpers purs vivent dans src/shared/autoclean.ts.
 */
export interface AutoCleanConfig {
  /** L'activation effective dépend du droit Pro (scheduledMaintenance). */
  enabled: boolean;
  trigger: AutoCleanTrigger;
  /** Heure "HH:MM" pour daily / weekly. */
  triggerTime: string;
  /** Jour 0-6 (0 = dimanche) pour weekly. */
  triggerDay: number;
  /** Seuil disque % pour le déclencheur "disk". */
  triggerPct: number;
  /** Opérations sélectionnées (au moins une). */
  actions: AutoCleanActionType[];
  /** Action appliquée : quarantaine (restaurable) ou corbeille Windows. */
  action: "quarantine" | "recycleBin";
  /** Seuil en Go des gros fichiers (action "largeFiles"). */
  largeFilesGo: number;
  /** Ancienneté en jours des téléchargements (action "oldDownloads"). */
  oldDownloadsDays: number;
}

/** État complet exposé au renderer (jamais la config seule). */
export interface AutoCleanState {
  config: AutoCleanConfig;
  /** Règle interne associée (null si jamais initialisée). */
  ruleId: number | null;
  lastRunAt: number | null;
  /** Prochaine exécution estimée (null si désactivé ou non planifiable). */
  nextRunAt: number | null;
  /** Vrai si une analyse est disponible pour simuler / exécuter. */
  hasScan: boolean;
  /** Historique des exécutions AutoClean (règle interne). */
  executions: RuleExecution[];
}

export interface ExcludedItem {
  id: number;
  path: string;
  kind: "folder" | "extension" | "file";
  createdAt: number;
}

export interface Overview {
  drives: DriveInfo[];
  recoverable: RecoverableSummary;
  filesAnalyzed: number;
  lastScanAt: number | null;
  lastScanId: number | null;
  insights: Insight[];
  trend: StorageTrend | null;
}

export interface Toast {
  id: number;
  kind: "success" | "error" | "info" | "warning";
  title: string;
  message?: string;
}

/* ---------------- MONÉTISATION ---------------- */

export type LicenseStatus = "free" | "trial_pro" | "pro" | "trial_expired" | "license_invalid" | "license_revoked";

export type LicenseValidationStatus = "valid" | "unverified" | "never" | "invalid" | "revoked";

export interface LicenseInfo {
  status: LicenseStatus;
  /** Vrai si l'utilisateur accède actuellement aux fonctions Pro (essai ou licence). */
  isPro: boolean;
  trialActive: boolean;
  /** Jours restants de l'essai Pro (0 si aucun essai actif). */
  trialDaysLeft: number;
  trialStartedAt: number | null;
  trialEndsAt: number | null;
  /** Vrai dès que l'essai a été utilisé : il ne recommence jamais. */
  trialUsed: boolean;
  licenseKey: string | null;
  /** Clé de licence cachée (affichage UI : dernier segment uniquement). */
  licenseKeyHint: string | null;
  activatedAt: number | null;
  /** Dernière validation réseau réussie (null si jamais validée). */
  lastValidatedAt: number | null;
  /** État de la validation de la licence (pour l'UI). */
  validationStatus: LicenseValidationStatus;
  /** True uniquement si DEV_PRO_OVERRIDE est défini sur un build non packagé. */
  devOverride: boolean;
}

export interface LicenseActivationResult {
  ok: boolean;
  /** Message utilisateur compréhensible (jamais de stack technique). */
  message: string;
  info: LicenseInfo;
}

export interface LicenseCheckoutResult {
  opened: boolean;
  message: string;
}

export interface NovaApi {
  // storage
  getDrives(): Promise<DriveInfo[]>;
  getOverview(): Promise<Overview>;
  // scan
  startScan(settings: ScanSettings): Promise<{ scanId: number }>;
  pauseScan(): Promise<void>;
  resumeScan(): Promise<void>;
  cancelScan(): Promise<void>;
  onScanProgress(cb: (p: ScanProgress) => void): () => void;
  onScanFinished(cb: (r: ScanResult) => void): () => void;
  onScanError(cb: (e: { scanId: number; message: string }) => void): () => void;
  getScanResult(scanId: number): Promise<ScanResult | null>;
  getLastScanResult(): Promise<ScanResult | null>;
  // explorer
  getDirChildren(scanId: number, path: string): Promise<DirChildrenResult | null>;
  // files
  getLargeFiles(scanId: number, minSize: number, offset: number, limit: number): Promise<PagedFiles>;
  getOldFiles(scanId: number, olderThanDays: number, offset: number, limit: number): Promise<PagedFiles>;
  getByCategory(scanId: number, category: string, offset: number, limit: number): Promise<PagedFiles>;
  getDownloads(scanId: number, offset: number, limit: number): Promise<PagedFiles>;
  getRecommendationDetail(scanId: number, kind: string, offset: number, limit: number): Promise<RecommendationDetail | null>;
  getDuplicates(scanId: number): Promise<DuplicateGroup[]>;
  // apps & games
  getApps(): Promise<AppInfo[]>;
  getGames(): Promise<GameInfo[]>;
  uninstallGame(gamePath: string, mode: "recycle" | "permanent"): Promise<{ ok: boolean; bytes: number; message: string }>;
  // uninstaller
  preAnalyzeApp(app: AppInfo): Promise<UninstallAnalysis>;
  runUninstaller(sessionId: string): Promise<UninstallRunResult>;
  getRemains(sessionId: string): Promise<UninstallRemain[]>;
  cleanRemains(sessionId: string, ids: string[]): Promise<CleanRemainsResult>;
  restoreQuarantine(sessionId: string): Promise<RestoreResult>;
  refreshApps(): Promise<AppInfo[]>;
  onUninstallProgress(cb: (p: UninstallProgress) => void): () => void;
  // cleanup
  cleanup(request: CleanupRequest): Promise<CleanupResult>;
  getRecycleBinInfo(): Promise<{ bytes: number; files: number }>;
  emptyRecycleBin(): Promise<{ freedBytes: number; fileCount: number; requestedBytes: number }>;
  onCleanupProgress(cb: (p: { done: number; total: number; current: string; bytesFreed: number }) => void): () => void;
  // history
  getHistory(): Promise<HistoryEvent[]>;
  getTrend(): Promise<StorageTrend | null>;
  // misc
  openPath(path: string): Promise<void>;
  openInFolder(path: string): Promise<void>;
  copyPath(path: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  pickFolders(): Promise<string[]>;
  getExclusions(): Promise<ExcludedItem[]>;
  addExclusion(item: { path: string; kind: "folder" | "extension" | "file" }): Promise<ExcludedItem>;
  removeExclusion(id: number): Promise<void>;
  getPreferences(): Promise<AppPreferences>;
  savePreferences(p: AppPreferences): Promise<void>;
  getVersion(): Promise<string>;
  // monétisation
  getLicenseInfo(): Promise<LicenseInfo>;
  startTrial(): Promise<LicenseInfo>;
  activateLicense(licenseKey: string): Promise<LicenseActivationResult>;
  restoreLicense(): Promise<LicenseActivationResult>;
  /** Ouvre le checkout Lemon Squeezy officiel dans le navigateur. */
  openCheckout(): Promise<LicenseCheckoutResult>;
  // coach
  getCoachReport(): Promise<CoachReport>;
  // gardien
  getGuardianReport(): Promise<GuardianReport>;
  runGuardianCheck(): Promise<GuardianReport>;
  onGuardianEvent(cb: (e: GuardianEvent) => void): () => void;
  onGuardianNavigate(cb: (page: string) => void): () => void;
  // automation
  getRules(): Promise<AutomationRule[]>;
  saveRule(rule: Omit<AutomationRule, "id" | "createdAt" | "updatedAt" | "runCount" | "lastRunAt">): Promise<number>;
  updateRule(rule: Partial<AutomationRule> & { id: number }): Promise<void>;
  deleteRule(id: number): Promise<void>;
  runRule(ruleId: number, dryRun?: boolean): Promise<RuleExecution>;
  getRuleExecutions(ruleId?: number, limit?: number): Promise<RuleExecution[]>;
  getDryRunPreview(rule: Omit<AutomationRule, "id" | "createdAt" | "updatedAt" | "runCount" | "lastRunAt">): Promise<DryRunResult>;
  // autoclean (Nova Pro)
  getAutoCleanState(): Promise<AutoCleanState>;
  saveAutoCleanConfig(config: AutoCleanConfig): Promise<AutoCleanState>;
  runAutoClean(dryRun: boolean): Promise<RuleExecution>;
  // app window
  minimize(): void;
  maximize(): void;
  close(): void;
  isMaximized(cb: (v: boolean) => void): () => void;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To", "Po"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("fr-FR");
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return "Jamais";
  const diff = ts - Date.now();
  // Futur (prochaine exécution, échéances) : libellé « Dans … ».
  if (diff >= 0) {
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Dans moins d'une minute";
    if (minutes < 60) return `Dans ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Dans ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `Dans ${days} j`;
    return formatDate(ts);
  }
  const past = -diff;
  const minutes = Math.floor(past / 60000);
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Il y a ${days} j`;
  return formatDate(ts);
}
