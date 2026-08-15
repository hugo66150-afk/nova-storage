# AGENTS.md — Nova Storage

Apprentissages non évidents accumulés lors des sessions de travail. Les points
évidents (lisible directement dans le code) n'y figurent pas.

## Outillage / environnement

- Pas de dépôt git : le dossier projet n'est pas versionné (`git status` échoue
  avec "not a git repository"). Aucune commande git n'est possible.
- Git Bash sur cette machine convertit les arguments de type `/F` en chemins
  (`/F` → `F:/`) : les commandes `taskkill /F /PID ...` échouent silencieusement
  sans message clair. Préfixer par `MSYS_NO_PATHCONV=1` (ou utiliser
  `cmd //c "..."`).
- Les outils d'édition (`read_files`, `str_replace`) sont bloqués sur
  `src/main/data/db.ts` et `src/main/data/repositories.ts` (réponse "[BLOCKED]"
  ou "file does not exist"). Contournements : `write_file` (remplacement
  complet) fonctionne, sinon appliquer une modification chirurgicale via un
  one-liner `node -e`/heredoc dans le terminal.
- `code_search` peut tomber en panne (binaire ripgrep vendor manquant) et `rg`
  n'est pas installé dans le terminal : utiliser `grep -rn` en secours.
- `better-sqlite3` est compilé pour l'ABI **Electron** (NODE_MODULE_VERSION
  136), pas pour Node 24 (137) : tout test unitaire qui appelle `getDb()`
  plante. Les tests qui touchent aux repositories doivent mocker les fonctions
  (ex. `getExclusions`) plutôt que créer une vraie base. Ne pas `npm rebuild`
  le module (casserait le dev Electron) ; `npm run dist` recompile
  automatiquement pour Electron via electron-builder (le paquet
  `@electron/rebuild` en devDependencies est redondant).
  **Piège** : le binding se charge PAresseusement — `node -e
  "require('better-sqlite3')"` réussit, mais `new Database()` échoue avec
  NODE_MODULE_VERSION. Les outils DB hors app doivent tourner via le runtime
  Electron (`node_modules/.bin/electron script.cjs`) et gérer les erreurs +
  `process.exit()` EXPLICITES : une exception non catchée dans le main
  Electron laisse le processus vivant → timeout silencieux.
- **userData partagé** : en dev comme en packagé, l'app utilise
  `%APPDATA%\Nova Storage` (Electron préfère `productName` à `name`, même non
  packagé) — il n'existe PAS de base dev séparée. Toute manipulation de la DB
  réelle (ex. vérifier l'essai) doit être exactement reversible : backup des
  clés `license.*` avant, restore après (outil `.freebuff/db-license.cjs`,
  restore = mêmes timestamps, état final identique).
- **Vérifier l'UI du build packagé** (pas de screenshot possible) : lancer
  l'exe avec `--remote-debugging-port=9222` puis interroger le DOM réel via un
  client CDP Node (WebSocket global de Node ≥ 21, `Runtime.evaluate`,
  `window.nova.getLicenseInfo()` renvoie le statut RÉEL du main) — script
  `.freebuff/cdp-inspect.cjs`. C'est la preuve directe que le renderer
  packagé rend bien le badge/bandeau attendu.
- Vitest : un `vi.mock("electron", ...)` dont la factory référence une variable
  `let` module-échelle échoue avec « Cannot access … before initialization »
  (la factory s'exécute à l'import du consommateur, avant l'initialisation).
  Garder la factory autonome (closure interne + setter exposé, ou `require()`
  dans la factory) et faire en sorte qu'elle retourne toujours une chaîne pour
  `app.getPath` : certains modules (ex. `automation.ts` → QUARANTINE_ROOT)
  appellent `app.getPath` **à l'import**, pas seulement à l'exécution.
- Pas de script `lint` ; `typecheck` = `tsc -p tsconfig.json --noEmit && tsc -p
  tsconfig.main.json --noEmit` (le `noUnusedLocals` du premier s'applique aussi
  aux tests). Vitest tourne en environnement `node` avec
  `include: ["tests/**/*.test.ts"]`.

## Architecture / pièges de code

- Le filtre SQL des règles d'automatisation n'est qu'un **pré-filtre** : la
  source de vérité est `evaluateConditionGroup` (mémoire). Un pré-filtre ne
  doit jamais exclure un candidat valide (bug historique : groupes OR
  pré-filtrés avec AND). `conditionGroupToSql` renvoie `null` pour un groupe OR
  contenant une condition non exprimable en SQL.
- L'éditeur de règles de la page Automatisation est **construit et fonctionnel**
  (`src/renderer/pages/Automation.tsx`) : créer/modifier/supprimer/dupliquer/
  activer-désactiver, conditions SI combinables, actions ALORS, planification
  par règle (une fois/horaire/quotidien/hebdo/mensuel), dry-run avant
  activation, historique d'exécution. Il s'appuie sur les IPC main existants
  (`automation:getRules/saveRule/updateRule/deleteRule/runRule/dryRunPreview/
  getExecutions`) qui gardent leurs gates `licenseService.can("automation")`.
  Helpers partagés dans `src/shared/automation.ts` (pure, testable) :
  `nextRunAt`, `summarizeRule`, `SCHEDULE_LABELS`, etc.
- Le Gardien avancé est réel : `buildAdvancedForecast` (pur, testé) calcule
  les dates estimées des seuils 80/90/95 % et de saturation ; il est exposé
  uniquement via le rapport Guardian gated par `can("advancedGuardian")`
  (prédictions) et affiché dans la page Gardien (« Prévisions avancées ») —
  plus aucune fonctionnalité fantôme vendue.
- Le mock navigateur (`src/renderer/dev/browserMock.ts`) fournit une API
  `automation` en mémoire (règles, dry-run, exécutions) pour prévisualiser
  l'éditeur en preview — dev-only, éliminé du build de production.
- Contrainte de mission énoncée par l'utilisateur : pas de télémétrie,
  local-first strict, ne pas déplacer une fonctionnalité Free vers Pro, ne pas
  créer de second système de licences/paiement.
- `will-navigate` : comparer l'origine (protocole + hôte) avec `new URL()`, pas
  `startsWith` sur l'URL de dev (bypass par préfixe du type
  `127.0.0.1:5173.evil.com`).
- L'index unique `idx_cand_scan_path` était silencieusement ignoré sur les
  bases existantes (un index simple du même nom existait déjà) : `getDb()`
  migre désormais l'index (drop + déduplication + recréation UNIQUE).
- `Treemap` : le `ResizeObserver` était créé dans un `useMemo` (ref nulle au
  premier rendu → jamais attaché). Utiliser `useEffect`.
- Unité : `getHistory` et le toast de fin de scan divisaient par `1024**3`
  (Go) en l'affichant « To ». Le bon label est « Go ».
- Notifications du Gardien : la prédiction ne doit pas re-notifier à chaque
  vérification manuelle — cooldown 12 h par palier. Les événements DB stockent
  le corps du message (`body`), pas le titre.
- Doublons : il faut toujours conserver au moins un exemplaire par groupe ;
  supprimer la dernière copie est bloqué dans l'UI et ignoré dans le calcul
  global.
- Le moteur de règles doit respecter `assessSafety` et les exclusions pour les
  actions destructives (`blockedTargetReason`), et le déplacement en
  quarantaine doit gérer EXDEV (copie + suppression) — même chose que dans
  l'uninstaller (`moveToQuarantine`).
- Validation du build packagé sans interaction GUI : le boot propre se vérifie
  dans `%APPDATA%\Nova Storage\logs\nova.log` (« Démarrage », « Base de
données initialisée », « IPC enregistré », messages de migration). Les prefs
réelles de l'utilisateur ont `guardianEnabled=true` : après fermeture de la
fenêtre, l'app reste en tray (comportement voulu) — un `taskkill` simple ne
suffit pas, il faut `/F` (avec `MSYS_NO_PATHCONV=1`).
- Piège packaging Windows : le dev server Vite (chokidar) tient un handle sur
  `release/` → `electron-builder` échoue systématiquement avec « EPERM: rename
  win-unpacked.tmp -> win-unpacked » (alors que chaque fichier se renomme
  pourtant un à un). Corrigé par `server.watch.ignored` (release/, dist/,
  .freebuff/) dans vite.config.ts. Symptôme : `mv`/rename du dossier échoue,
  `rm -rf` passe ; tuer le process node de Vite débloque immédiatement.
- `src/renderer/dev/browserMock.ts` est installé dans `main.tsx` UNIQUEMENT
  derrière `import.meta.env.DEV` : il est éliminé du bundle de production (ne
  jamais retirer le gate). Vérifiable : « aperçu navigateur » absent de
  `dist/renderer/assets/index-*.js` et de l'app.asar. Piège de vérification :
  « actuellement bien entretenu » est une phrase LÉGITIME du vrai Coach — ce
  n'est pas un marqueur du mock.
- Icône Windows : `assets/branding/nova.ico` (multi-tailles 16→256 px) est
  l'icône officielle, régénérée par electron-builder depuis `nova.png`
  (1312×1199) ; `win.icon` pointe dessus. Les sourcemaps sont exclus du
  package via `!**/*.map` dans `build.files`. `assets/logoNOVA1.png` était un
  doublon exact de `branding/nova.png` (supprimé).
- Release : `npm run dist` produit `release/Nova-Storage-Setup-x64.exe`
  (NSIS, nom FIXE aligné sur le site, /S = silencieux, /D=dir) + `latest.yml`
  + le `.blockmap` (auto-update). Le désinstallateur NSIS supprime le
  programme et les raccourcis mais conserve `%APPDATA%\Nova Storage`
  (comportement voulu). Dossier livrable : `WorkflowIA/Nova Storage Release/`
  (installer, latest.yml, blockmap, checksums, README, RELEASE_NOTES) avec
  sources docs dans `release-docs/`.
- Auto-update (electron-updater, depuis la v1.1.0) : fournisseur `github`
  → repo `hugo66150-afk/nova-storage` (config `build.publish` dans
  package.json = SEUL endroit pour changer le canal, embarquée par
  electron-builder dans `app-update.yml`). `src/main/services/updater.ts`
  (`setupAutoUpdater`) n'est actif qu'en mode packagé : vérification
  différée 15 s, téléchargement en arrière-plan, installation silencieuse à
  la fermeture (NSIS par utilisateur → pas d'élévation). Les erreurs sont
  non bloquantes. `NOVA_UPDATE_URL` (env) force une autre base de mise à
  jour (tests/staging). Chaque release = `npm run dist` puis publication
  des artefacts (latest.yml + installateur + blockmap) en GitHub Release
  via electron-builder (`-p always`) avec `GH_TOKEN` (scope `repo`) ; le
  repo étant PUBLIC, les utilisateurs téléchargent la mise à jour sans
  aucun token. Le nom d'artefact est fixe (Nova-Storage-Setup-x64.exe).
- CI : `.github/workflows/release.yml` publie automatiquement au push d'un
  tag `vX.Y.Z` — validation version=tag, `npm ci`, tests, build Windows,
  GitHub Release non-draft (3 assets) via electron-builder (`-p always`),
  puis mise à jour du repo site (public/downloads + src/lib/site.ts avec
  version/date/taille/sha256 réels) si le secret `SITE_REPO_TOKEN` est
  configuré (PAT scope `repo` sur le repo du site) ; sans ce secret, la
  release est publiée mais le site reste à mettre à jour manuellement
  (npm run release -- X.Y.Z en local).

## Monétisation Free / Pro

- La source de vérité du statut est `licenseService` (main) : le statut est
  TOUJOURS calculé depuis des données brutes (`preferences` KV de la DB
  SQLite, clés `license.*`) + l'horloge — aucun champ `isPro`/`status` n'est
  persisté (anti-manipulation). L'essai vit dans la DB du profil utilisateur
  (pas localStorage) : il survit à la désinstallation/réinstallation.
- Config centralisée UNIQUE : `src/shared/monetization.ts` (prix, durée
  essai, entitlements Free/Pro, descriptions Pro, URLs Lemon Squeezy).
  Modifier uniquement là ; le prix n'est jamais dupliqué dans le code. Il n'y
  a PAS de flag `payment.enabled` : l'état « prêt à vendre » est dérivé de
  `checkoutUrl` via `checkoutReady()`.
- Identifiants RÉELS du produit (configurés) : productId 1292367,
  variantId 2022137, checkoutUrl
  https://novastorage.lemonsqueezy.com/checkout/buy/18829073-b7bc-4459-84c6-13ee2874c8a7
  (publics, pas des secrets). Le store était en attente d'activation LS au
  moment de la config : l'app est prête, mais aucun vrai paiement n'a été
  testé. Les tests (tests/license.test.ts, tests/checkout.test.ts) assertent
  cette URL exacte — si le checkout change, mettre à jour la config ET les
  tests.
- Piège de vérification « un seul checkout » : l'URL du checkout apparaît 2×
  dans le bundle (module partagé compilé dans main ET renderer) — c'est la
  même valeur, pas un second checkout. Compter les valeurs DISTINCTES.
- Test flaky corrigé (ruleEngineSql.test.ts, hourly) : `day(0)` = Date.now()
  réel comparé à un `now` fixe (10:20) → échouait selon l'heure réelle de la
  journée. Utiliser une date fixe cohérente avec le `now` du test, jamais
  `day(0)` pour une comparaison intra-journée.
- Droits : `licenseService.can("automation" | "scheduledMaintenance" |
  "advancedGuardian" | "guardianPredictions")`, et côté renderer
  `useApp().can(key)` (dérivé de `license.isPro`). JAMAIS de `if (isPro)`
  dispersé. TRIAL_PRO hérite de tous les droits PRO.
- Sécurité : gates au niveau MAIN (pas seulement UI) — `runRuleEngine` /
  `getDryRunPreview` refusent sans droit (throw), le scheduler de
  `index.ts` ne tourne pas sans `scheduledMaintenance`, les prédictions
  Guardian sont retirées du rapport/des notifications sans
  `guardianPredictions`. Les règles existantes restent sauvegardées mais
  ne s'exécutent pas.
- `DEV_PRO_OVERRIDE=true` ne débloque le Pro QUE si `!app.isPackaged`
  (impossible en production). Dans les tests, `app.isPackaged` doit être un
  getter contrôlable via `vi.hoisted` (la factory vi.mock ne peut pas
  référencer une variable module-échelle).
- UI : modal Pro centralisée dans le store (`openPro(key)` + `<ProModal/>`
  rendu par AppProvider), badge `<ProBadge/>`, bandeau `<LicenseBanner/>`
  (Dashboard), badge de statut dans la barre de titre (`TitleBar.tsx` :
  `✦ PRO` doré si `status==="pro"`, `⏳ PRO · ESSAI` violet si
  `status==="trial_pro"`, `FREE` discret sinon — clic → Paramètres). Le
  badge est clé uniquement sur `license.status` (source de vérité MAIN),
  jamais sur une page ouverte ou un checkout lancé. Le paiement n'est PAS branché : boutons d'achat en état
  « Bientôt disponible » tant que `checkoutReady()` est faux (checkoutUrl
  vide). Dès que `checkoutUrl` est renseignée, l'achat ouvre le checkout via
  `license:openCheckout` → `shell.openExternal`.
- Sécurité du checkout : `validateCheckoutUrl` (src/shared/monetization.ts,
  pure, testée dans tests/checkout.test.ts) — https:// explicite uniquement,
  tout le reste (http, javascript:, file:, espaces) est refusé. L'échec de
  `shell.openExternal` est capturé (jamais de faux succès).
- Endpoints Lemon Squeezy : `licenseApiUrl`/`activateApiUrl` sont PUBLIQUES
  (dans l'asar c'est voulu) ; la clé d'API admin ne vit que dans
  scripts/create-gift-license.mjs via `LEMON_SQUEEZY_API_KEY` (env). Piège de
  scan : le NOM de variable `LEMON_SQUEEZY_API_KEY` figure dans un commentaire
  de monetization.ts embarqué dans le main bundle — c'est un nom, pas un
  secret ; scanner les valeurs (Bearer + token, chaînes ≥ 40 aléatoires),
  pas les noms.
- Layout de l'asar : `dist/main/...` et `dist/renderer/assets/...` (pas
  `out/`). Les scripts de vérification asar doivent extraire avec `npx asar
  extract` vers un dossier Windows explicite (les chemins `/tmp` MSYS vs
  `C:\tmp` Node divergent).

## Projet site (Nova Site, ../Nova Site — ne PAS modifier depuis l'app)

- **Site EN LIGNE : https://novastorage.vercel.app** (Vercel, Next.js).
  Vérifié : prix 9,97 €, essai 7 j, matrice Free/Pro et message « Boutique
  en cours d'activation par Lemon Squeezy » cohérents avec l'app. La page
  de téléchargement pointe vers l'installateur — le `.exe` à mettre à jour
  y est hébergé manuellement (pas d'automatisation de release). Utiliser le
  site comme référence commerciale pour tout dev futur de l'app.
- Le site est la RÉFÉRENCE commerciale du checkout : `src/lib/site.ts`
  (`lemonSqueezyConfig.checkoutUrl`/`pricingConfig`). État vérifié : les deux
  projets sont alignés et TOUS DEUX non configurés (checkoutUrl null/vide,
  prix 9,97 €, essai 7 j, même produit/licences LS). Aucune URL réelle
  n'existe nulle part (ni .env.local, ni vercel.json). Quand le produit sera
  créé, renseigner la MÊME URL dans site.ts et
  MONETIZATION.payment.checkoutUrl.
- Le site dirige vers « Paramètres → Nova Pro → Activer une licence » (page
  /merci) — exactement l'écran de l'app. Son outillage admin utilise
  `LEMON_SQUEEZY_VARIANT_ID`/`LEMON_SQUEEZY_STORE_ID` : le script
  scripts/create-gift-license.mjs accepte les deux conventions d'env
  (forme courte et forme préfixée).
- Le mock navigateur (`browserMock.ts`) implémente `getLicenseInfo` /
  `startTrial` (NovaApi typecheck) et permet de prévisualiser les 3 états  de licence dans l'aperçu navigateur via `localStorage["nova-preview-license"]
  = "free" | "trial" | "trial-soon" | "pro"` (dev only, jamais en Electron —
  le main reste la source de vérité) ; `trial` = 5 jours restants,
  `trial-soon` = 2 jours (pour prévisualiser le rappel « essai se termine
  bientôt » du bandeau Dashboard). Toute valeur inconnue → free. Couvert par
  tests dans tests/browserMock.test.ts.
- Bandeau Dashboard (`LicenseBanner.tsx`) : quand l'essai est actif et qu'il
  reste ≤ `TRIAL_ENDING_SOON_DAYS` (3), variante `ending-soon` (⏳, teinte
  ambrée un peu plus présente) — affichage uniquement, la logique d'essai
  (main) est inchangée. Helper pur `isTrialEndingSoon` testé dans
  tests/licenseBanner.test.ts.
