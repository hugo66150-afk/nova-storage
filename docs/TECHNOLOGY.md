# Nova Storage — Choix technologique

## Contexte

Nova Storage est un gestionnaire intelligent du stockage Windows : il doit analyser
les disques, classifier le contenu, protéger les fichiers critiques, recommander des
nettoyages sûrs et suivre l'évolution du stockage — avec une interface moderne et
spectaculaire, distribuable publiquement.

## Environnement évalué

| Technologie | Disponibilité | Verdict |
|---|---|---|
| Node.js 24 / npm 11 | ✅ installé | — |
| .NET 10 SDK | ✅ installé | — |
| Python 3.11 / 3.13 | ✅ installé | — |
| Rust / Cargo | ❌ non installé | Tauri exclu |

## Décision : Electron + React + TypeScript + Vite

### Critères de décision (classés par priorité du cahier des charges)

1. **Performance** — Le scan de millions de fichiers est borné par l'I/O disque.
   Node.js traite l'I/O de manière asynchrone ; le moteur de scan utilise des
   `worker_threads` pour paralléliser raisonnablement. Les résultats sont agrégés
   et persistés en SQLite. L'interface reste fluide : le scan ne touche jamais le
   thread de rendu React.

2. **Accès fiable au système de fichiers Windows** — Le process main Electron est
   du Node.js natif : chemins Windows, attributs, permissions, jetons, gestion de la
   corbeille (via `RecycleBin` implémenté avec `Shell32.SHFileOperation`), détection
   de fichiers verrouillés. Aucune barrière de permission côté interface.

3. **Interface moderne + animations** — Le cahier des charges demande glass/blur,
   glow, dégradés, animations, treemap interactif, graphiques interactifs (points
   10, 11, 35, 36, 48). Le CSS moderne (backdrop-filter, transitions, composants
   SVG réactifs) atteint ce niveau de finition rapidement et de façon maintenable.
   Atteindre le même résultat en WPF/WinUI demanderait un effort XAML disproportionné.

4. **Stabilité** — Séparation stricte : toute la logique (scan, classification,
   sécurité, nettoyage, base) vit dans le process main et les workers. L'UI est un
   client passif. Un plantage d'un worker ne tue pas l'application. Gestion
   d'erreurs centralisée (accès refusé, fichier verrouillé, disque déconnecté…).

5. **Packaging Windows + distribution** — `electron-builder` produit un installateur
   NSIS (x64). AppId, raccourcis bureau/démarrage, icônes gérés.

6. **Maintenabilité** — TypeScript partagé entre moteur et UI (`src/shared`),
   modules purs testables (Vitest), architecture en couches claire.

## Architecture

```
Nova Storage
│
├── src/main                 # Process main Electron (moteur)
│   ├── engine               #   Storage Engine / Scanner / Classifier / Safety / Cleanup / Analysis
│   ├── data                 #   SQLite, repositories, migrations
│   ├── services             #   Détection apps, caches, FS, corbeille
│   └── infra                #   Logging, erreurs
├── src/renderer             # UI React (client passif)
│   ├── design               #   Design System Nova
│   ├── components           #   Composants réutilisables + graphiques
│   ├── pages                #   Dashboard, Analyse, Explorer, Nettoyage…
│   └── state                #   État UI
├── src/shared               # Types + constantes partagés
└── tests                    # Tests unitaires (Vitest)
```

### Règles d'architecture

- **L'UI ne contient aucune logique d'analyse.** Toute opération passe par une API
  IPC typée exposée dans `preload.cjs` (contextBridge, canal par canal).
- **Le scan est non bloquant** : worker threads, pause/annulation par signal.
- **Aucun nettoyage aveugle** : chaque suppression passe par
  détection → explication → confirmation → action (point 45).
- **Local-first** : aucune donnée n'est transmise hors de la machine (point 41).
- **Base locale** : SQLite (`better-sqlite3`), stratégie de rétention (point 40).

## Précisions sécurité

- Suppression privilégiée : **mise à la corbeille Windows** (point 20). La
  suppression définitive est réservée aux cas nécessaires et toujours affichée
  comme telle.
- Les zones Windows critiques (Windows, System32, Program Files, etc.) sont
  protégées : classification `PROTÉGÉ`, aucune suppression recommandée.
- Chaque élément supprimable porte un niveau de confiance (`SÛR`, `À EXAMINER`,
  `ATTENTION`, `RISQUÉ`, `PROTÉGÉ`).

## Base de données

SQLite via `better-sqlite3` (module natif, recompilé pour Electron via
`electron-builder install-app-deps` au moment du packaging). Tables : `scans`,
`scan_categories`, `tree_nodes`, `candidates` (fichiers nettoyables uniquement,
pas 1 ligne par fichier permanent), `cleanups`, `exclusions`, `preferences`,
`snapshots`, `guardian_events`, `automation_rules`, `rule_executions`. Le schéma
est créé dans `src/main/data/db.ts` (CREATE TABLE IF NOT EXISTS) ; les migrations
ciblées (ex. index) s'exécutent à l'ouverture. Stratégie de rétention : les
`N` derniers scans `completed`/`partial` sont conservés, le reste est purgé après
échéance (jours).
