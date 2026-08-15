# Nova Storage — Signature de code Windows

> **État actuel : NON SIGNÉ.** Vérifié avec `Get-AuthenticodeSignature` :
> `NotSigned` pour l'exécutable et l'installateur. La signature est un
> prérequis avant la distribution publique (SmartScreen).

## Ce qui est déjà en place

- `electron-builder` (déjà utilisé par `npm run dist`) signe automatiquement
  l'exécutable, `elevate.exe` et l'installateur NSIS **dès qu'un certificat
  est disponible**, sans modification de configuration.
- Aucun certificat, aucune clé, aucun mot de passe n'est présent dans le
  dépôt (vérifié). La signature est pilotée exclusivement par des variables
  d'environnement (jamais commitées).

## Procédure (à exécuter sur la machine de release)

1. **Obtenir un certificat de code signing** (authentification OV ou EV —
   recommandé : Sectigo, DigiCert, ou GlobalSign via votre revendeur).
2. **Exporter le certificat au format `.pfx`** (avec sa clé privée) depuis
   votre autorité de certification.
3. **Définir les variables d'environnement** (jamais dans Git) :

   ```powershell
   # PowerShell
   $env:WIN_CSC_LINK = "C:\secrets\nova-storage-code-signing.pfx"
   $env:WIN_CSC_KEY_PASSWORD = "<mot de passe du pfx>"
   ```

   Noms alternatifs reconnus par electron-builder : `CSC_LINK` /
   `CSC_KEY_PASSWORD` (toutes plateformes) ou `WIN_CSC_LINK` /
   `WIN_CSC_KEY_PASSWORD` (Windows uniquement). Le `.pfx` doit rester hors
   du dossier projet et hors de tout dépôt.
4. **Reconstruire** :

   ```bash
   npm run dist
   ```

5. **Vérifier la signature** de chaque binaire produit :

   ```powershell
   Get-AuthenticodeSignature "release\win-unpacked\Nova Storage.exe"
   Get-AuthenticodeSignature "release\Nova Storage Setup 1.0.0.exe"
   Get-AuthenticodeSignature "release\Nova Storage 1.0.0.exe"
   ```

   Attendu : `Status = Valid`, `SignerCertificate` = votre éditeur.

## Vérification manuelle (sans reconstruction)

```powershell
Get-AuthenticodeSignature "<chemin du fichier>"
```

`Status = NotSigned` → non signé. `Status = Valid` → signé et chaîne
valide. `UnknownError`/`HashMismatch` → problème à corriger.

## Pipelines (CI) — principe

- Les secrets de signature vivent dans le gestionnaire de secrets du
  pipeline (ex. GitHub Actions `secrets.`), injectés comme variables
  d'environnement au moment du packaging uniquement.
- Le `.pfx` est stocké en secret, jamais dans le dépôt.
- L'étape de signature est la dernière avant publication des artefacts.

## Rappel honnête

Tant que `Get-AuthenticodeSignature` renvoie `NotSigned`, Nova Storage
déclenchera un avertissement SmartScreen (« Éditeur inconnu ») chez les
utilisateurs. La signature ne change pas le fonctionnement de l'application ;
elle améliore la confiance Windows et réduit les faux positifs antivirus.
