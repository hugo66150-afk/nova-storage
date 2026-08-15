#!/usr/bin/env node
/**
 * Publication complète d'une release Nova Storage.
 *
 * Usage :
 *   npm run release -- <X.Y.Z> [--dry-run] [--notes <fichier>]
 *
 * Exemples :
 *   npm run release -- 1.2.0
 *   npm run release -- --dry-run 1.2.0     # pré-vol + plan, sans rien modifier
 *
 * Étapes :
 *   1. Pré-vol : version valide (>= version actuelle), repo git propre
 *      (seuls package.json / scripts/ / release-docs/ peuvent être modifiés),
 *      `gh` présent et authentifié.
 *   2. Bump de la version dans package.json.
 *   3. Typecheck + tests.
 *   4. Build : npm run dist (installateur NSIS + latest.yml + blockmap).
 *   5. Vérification des artefacts : latest.yml cohérent avec l'installateur
 *      (version, sha512, taille).
 *   6. Régénération du dossier livrable (../Nova Storage Release) :
 *      installer/, latest.yml, blockmap, checksums, README, RELEASE_NOTES.
 *   7. Publication sur le site : public/downloads/ + src/lib/site.ts
 *      (version, date, taille, sha256) + typecheck/lint/build du site.
 *   8. Commit + push (dépôt app puis dépôt site — uniquement les fichiers
 *      de la release, jamais les fichiers modifiés par d'autres).
 *   9. GitHub Release v<X.Y.Z> avec les 3 assets (latest.yml, exe, blockmap).
 *
 * Options :
 *   --dry-run   Exécute le pré-vol puis affiche le plan complet, sans modifier
 *               ni publier quoi que ce soit.
 *   --notes <f> Fichier de notes pour la GitHub Release (défaut :
 *               release-docs/RELEASE_NOTES.txt).
 *
 * Environnement (défauts : dossiers voisins de ce dépôt) :
 *   NOVA_SITE_DIR     dossier du site (défaut : ../Nova Site)
 *   NOVA_RELEASE_DIR  dossier livrable (défaut : ../Nova Storage Release)
 */

import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_DIR = path.resolve(APP_ROOT, process.env.NOVA_SITE_DIR || "../Nova Site");
const RELEASE_DIR = path.resolve(APP_ROOT, process.env.NOVA_RELEASE_DIR || "../Nova Storage Release");

const GITHUB_REPO = "hugo66150-afk/nova-storage";
const APP_REMOTE_BRANCH = "origin main";
const SITE_REMOTE_BRANCH = "origin main";

// Fichiers que le script est autorisé à modifier/committer côté app. Tout autre
// changement non commité bloque la release (sécurité : release reproductible).
const ALLOWED_APP_PATHS = ["package.json", "scripts/", "release-docs/"];

const INSTALLER_NAME = "Nova-Storage-Setup-x64.exe";
const BLOCKMAP_NAME = `${INSTALLER_NAME}.blockmap`;
const META_FILES = ["latest.yml", BLOCKMAP_NAME];

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

// --- Arguments -----------------------------------------------------------------
const args = process.argv.slice(2);
let version = null;
let dryRun = false;
let notesFile = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--dry-run") dryRun = true;
  else if (a === "--notes") notesFile = args[++i];
  else if (a.startsWith("--")) {
    console.error(`Option inconnue : ${a}`);
    process.exit(2);
  } else version = a;
}

if (!version) {
  console.error(`Usage : npm run release -- <X.Y.Z> [--dry-run] [--notes <fichier>]`);
  process.exit(2);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Version invalide : « ${version} » (attendu : X.Y.Z)`);
  process.exit(2);
}

// --- Helpers --------------------------------------------------------------------
function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: "inherit", cwd: APP_ROOT, ...opts });
}

function resolveGh() {
  const candidates = [
    process.env.GH_PATH,
    "C:\\Users\\hugo6\\AppData\\Local\\Microsoft\\WinGet\\Packages\\GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe\\bin\\gh.exe",
    "C:\\Program Files\\GitHub CLI\\gh.exe",
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return "gh"; // dépend du PATH
}

function gh(argsArr, opts = {}) {
  return execFileSync(resolveGh(), argsArr, { stdio: "inherit", ...opts });
}

function semver(v) {
  return v.split(".").map((n) => Number(n));
}

function cmpSemver(a, b) {
  const [x, y, z] = semver(a);
  const [p, q, r] = semver(b);
  return x - p || y - q || z - r;
}

function sha256Hex(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function sha512Base64(file) {
  return createHash("sha512").update(readFileSync(file)).digest("base64");
}

function sizeMo(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} Mo`; // arrondi MiB, comme Windows
}

function todayFr() {
  const d = new Date();
  return `${d.getDate()} ${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function porcelainPath(line) {
  return line.slice(3).replace(/^"(.*)"$/, "$1");
}

// --- Pré-vol ---------------------------------------------------------------------
function gitStatusPorcelain(dir) {
  try {
    // Lignes brutes (sans trim) : le préfixe XY de statut est significatif
    // (« M file » → le chemin commence à l'index 3).
    return execSync("git status --porcelain", { cwd: dir, encoding: "utf8" })
      .split("\n")
      .filter((l) => l.length > 0);
  } catch {
    return null; // pas un dépôt git
  }
}

function isAllowedAppPath(p) {
  return ALLOWED_APP_PATHS.some((a) => p === a || p.startsWith(a));
}

function preflight() {
  const problems = [];

  // 1. Version >= actuelle
  const pkg = readJson(path.join(APP_ROOT, "package.json"));
  if (cmpSemver(version, pkg.version) < 0) {
    problems.push(`La version ${version} est inférieure à la version actuelle (${pkg.version}).`);
  }

  // 2. Repo app : propre, sauf fichiers de release
  const dirty = gitStatusPorcelain(APP_ROOT);
  if (dirty === null) {
    problems.push(`« ${APP_ROOT} » n'est pas un dépôt git.`);
  } else {
    const blocking = dirty.filter((l) => !isAllowedAppPath(porcelainPath(l)));
    if (blocking.length > 0) {
      problems.push(
        `Changements non commités qui bloquent la release (commit ou stash d'abord) :\n${blocking
          .map((l) => `    ${l}`)
          .join("\n")}`
      );
    }
  }

  // 3. Repo site : doit exister (il peut avoir des changements d'autres personnes,
  //    on ne stage que nos fichiers)
  if (!existsSync(path.join(SITE_DIR, "package.json"))) {
    problems.push(`Dossier du site introuvable : ${SITE_DIR} (variable NOVA_SITE_DIR ?)`);
  }

  // 4. gh présent + authentifié
  try {
    execFileSync(resolveGh(), ["--version"], { stdio: "ignore" });
    execFileSync(resolveGh(), ["auth", "token"], { stdio: "ignore" });
  } catch {
    problems.push("GitHub CLI (gh) est introuvable ou non authentifié (gh auth login).");
  }

  return problems;
}

// --- Plan ------------------------------------------------------------------------
function printPlan() {
  const pkg = readJson(path.join(APP_ROOT, "package.json"));
  const exe = path.join(APP_ROOT, "release", INSTALLER_NAME);
  console.log("");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  RELEASE NOVA STORAGE  v${version}   (actuelle : v${pkg.version})`);
  console.log("══════════════════════════════════════════════════════════════");
  console.log("");
  const steps = [
    "1. Bump package.json → " + version,
    "2. npm run typecheck && npm test",
    "3. npm run dist  (installateur NSIS + latest.yml + blockmap)",
    "4. Vérification latest.yml ↔ installateur (version, sha512, taille)",
    "5. Régénération du livrable : " + RELEASE_DIR,
    "6. Publication site : public/downloads/ + src/lib/site.ts (version, date, taille, sha256)",
    "7. Typecheck + lint + build du site",
    `8. Commit + push app  (« release: v${version} » → ${APP_REMOTE_BRANCH})`,
    `9. Commit + push site (site.ts + downloads → ${SITE_REMOTE_BRANCH})`,
    `10. GitHub Release v${version} (${GITHUB_REPO}) avec latest.yml, ${INSTALLER_NAME}, ${BLOCKMAP_NAME}`,
  ];
  for (const s of steps) console.log(`  ${s}`);
  console.log("");
  if (existsSync(exe)) {
    console.log(`  (installateur local actuel : sha256 ${sha256Hex(exe).slice(0, 16)}… — sera remplacé par le build)`);
  }
  console.log("");
  console.log(`  Notes de la GitHub Release : ${notesFile || "release-docs/RELEASE_NOTES.txt"}`);
  console.log("");
}

// --- Vérification des artefacts --------------------------------------------------
function verifyArtifacts() {
  const releaseDir = path.join(APP_ROOT, "release");
  const exe = path.join(releaseDir, INSTALLER_NAME);
  const latestYml = path.join(releaseDir, "latest.yml");

  for (const f of [exe, latestYml, path.join(releaseDir, BLOCKMAP_NAME)]) {
    if (!existsSync(f)) throw new Error(`Artefact manquant après le build : ${f}`);
  }

  const yml = readFileSync(latestYml, "utf8");
  const mVersion = yml.match(/^version:\s*(\S+)/m);
  // `size:` et `sha512:` peuvent être indentés (bloc files:) ou à la racine
  // selon la version d'electron-builder — on ne s'ancre pas sur la colonne 0.
  const mSha = yml.match(/sha512:\s*(\S+)/);
  const mSize = yml.match(/size:\s*(\d+)/);

  if (!mVersion || mVersion[1] !== version) {
    throw new Error(`latest.yml annonce la version ${mVersion ? mVersion[1] : "?"} au lieu de ${version}.`);
  }

  const realSha = sha512Base64(exe);
  if (mSha && mSha[1] !== realSha) {
    throw new Error("latest.yml sha512 ≠ hash réel de l'installateur — build incohérent.");
  }

  const realSize = statSync(exe).size;
  if (mSize && Number(mSize[1]) !== realSize) {
    throw new Error(`latest.yml taille ${mSize[1]} ≠ taille réelle ${realSize} — build incohérent.`);
  }

  console.log(`✅ Artefacts cohérents : v${version}, sha512 OK, ${sizeMo(realSize)}.`);
}

// --- Livrable --------------------------------------------------------------------
function regenerateDeliverables() {
  mkdirSync(path.join(RELEASE_DIR, "installer"), { recursive: true });
  mkdirSync(path.join(RELEASE_DIR, "checksums"), { recursive: true });

  const releaseDir = path.join(APP_ROOT, "release");
  const exe = path.join(releaseDir, INSTALLER_NAME);

  copyFileSync(exe, path.join(RELEASE_DIR, "installer", INSTALLER_NAME));
  for (const name of META_FILES) copyFileSync(path.join(releaseDir, name), path.join(RELEASE_DIR, name));

  // Docs (copies fidèles des sources, à mettre à jour dans release-docs/)
  copyFileSync(path.join(APP_ROOT, "release-docs", "RELEASE_NOTES.txt"), path.join(RELEASE_DIR, "RELEASE_NOTES.txt"));
  copyFileSync(path.join(APP_ROOT, "release-docs", "README.txt"), path.join(RELEASE_DIR, "README.txt"));

  const checksums = [
    `# NOVA STORAGE — SHA-256 des fichiers distribuables (v${version})`,
    `# Généré le ${new Date().toISOString()}`,
    "",
    `${sha256Hex(exe)}  installer/${INSTALLER_NAME}`,
    "",
  ].join("\n");
  writeFileSync(path.join(RELEASE_DIR, "checksums", "SHA256SUMS.txt"), checksums);

  console.log(`✅ Livrable régénéré : ${RELEASE_DIR}`);
  console.log(`    installer/${INSTALLER_NAME} (${sizeMo(statSync(exe).size)}), latest.yml, ${BLOCKMAP_NAME}, checksums/, README.txt, RELEASE_NOTES.txt`);
}

// --- Publication site --------------------------------------------------------------
function publishSite() {
  // 1. Copie des fichiers dans public/downloads/ (script existant du site)
  sh(`node scripts/release.mjs "${RELEASE_DIR}"`, { cwd: SITE_DIR });

  // 2. Mise à jour de src/lib/site.ts (version, date, taille, sha256)
  const exe = path.join(APP_ROOT, "release", INSTALLER_NAME);
  const siteTsPath = path.join(SITE_DIR, "src", "lib", "site.ts");
  let src = readFileSync(siteTsPath, "utf8");

  // Garde anti-corruption : un fichier tronqué/partiel (lecture concurrente)
  // ne doit JAMAIS être réécrit. Si la lecture est douteuse, on abandonne.
  if (!src.includes("downloadConfig") || !src.includes("version:")) {
    throw new Error(`${siteTsPath} illisible ou tronqué (${src.length} octets) — aucun écriture effectuée.`);
  }

  // Regex tolérantes (guillemets simples OU doubles) pour survivre à un
  // reformatage de l'éditeur ; le champ visé est conservé via $1.
  const edits = [
    [/(version\s*:\s*)['"][\d.]+['"]/, `$1'${version}'`],
    [/(date\s*:\s*)['"][^'"]*['"]/, `$1'${todayFr()}'`],
    [/(size\s*:\s*)['"][^'"]*['"]/, `$1'${sizeMo(statSync(exe).size)}'`],
    [/(sha256\s*:\s*)['"][0-9a-fA-F]+['"]/, `$1'${sha256Hex(exe)}'`],
  ];

  for (const [re, replacement] of edits) {
    // On vérifie la PRÉSENCE du motif, pas le changement de chaîne : si la
    // valeur cible est déjà en place (ex. date = aujourd'hui), le replace est
    // un no-op légitime et il ne faut pas le traiter comme une erreur.
    if (!re.test(src)) {
      // Diagnostic : montre les lignes contenant le champ pour comprendre
      const fm = re.source.match(/\((version|date|size|sha256)\s*:\\s*\)/);
      const field = fm ? fm[1] : "?";
      const ctx = src
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.includes(field))
        .slice(0, 5)
        .join(" | ");
      throw new Error(`Impossible de mettre à jour ${siteTsPath} (motif ${re} introuvable). Contexte : ${ctx}`);
    }
    src = src.replace(re, replacement);
  }

  if (!src.includes(`version: '${version}'`) || !src.includes(`sha256: '${sha256Hex(exe)}'`)) {
    throw new Error(`Édition de ${siteTsPath} incohérente — aucun écriture effectuée.`);
  }

  writeFileSync(siteTsPath, src);
  console.log(`✅ ${path.relative(SITE_DIR, siteTsPath)} mis à jour (v${version}, ${sizeMo(statSync(exe).size)}, sha256 OK).`);

  // 3. Validation du site
  sh("npm run typecheck && npm run lint && npm run build", { cwd: SITE_DIR });
  console.log("✅ Site : typecheck + lint + build OK.");
}

// --- Git ---------------------------------------------------------------------------
function gitAddAndCommit(dir, files, message) {
  if (files.length === 0) {
    console.log(`  (rien à committer dans ${dir})`);
    return;
  }
  execSync(`git add -- ${files.join(" ")}`, { cwd: dir, stdio: "inherit" });
  try {
    execSync("git diff --cached --quiet", { cwd: dir, stdio: "ignore" });
    console.log(`  (rien de nouveau à committer dans ${dir})`);
    return;
  } catch {
    /* des changements sont stagés */
  }
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: "inherit" });
}

function pushAppAndSite() {
  // App : bump + script de release + notes modifiées (rien d'autre)
  const dirty = gitStatusPorcelain(APP_ROOT) ?? [];
  const appFiles = ["package.json", "scripts/release.mjs"];
  for (const l of dirty) {
    const rel = porcelainPath(l);
    if (rel.startsWith("release-docs/") && !appFiles.includes(rel)) appFiles.push(rel);
  }
  gitAddAndCommit(APP_ROOT, appFiles, `release: v${version}`);
  execSync(`git push ${APP_REMOTE_BRANCH}`, { cwd: APP_ROOT, stdio: "inherit" });
  console.log(`✅ Dépôt app poussé (${APP_REMOTE_BRANCH}).`);

  // Site : uniquement nos fichiers (ne JAMAIS toucher aux fichiers des autres)
  const siteFiles = [
    "src/lib/site.ts",
    "public/downloads/Nova-Storage-Setup-x64.exe",
    "public/downloads/latest.yml",
    `public/downloads/${BLOCKMAP_NAME}`,
  ];
  gitAddAndCommit(SITE_DIR, siteFiles, `release: v${version} (downloads + config)`);
  execSync(`git push ${SITE_REMOTE_BRANCH}`, { cwd: SITE_DIR, stdio: "inherit" });
  console.log(`✅ Dépôt site poussé (${SITE_REMOTE_BRANCH}).`);
}

// --- GitHub Release -----------------------------------------------------------------
function publishGithubRelease() {
  const notes = notesFile
    ? path.resolve(APP_ROOT, notesFile)
    : path.join(APP_ROOT, "release-docs", "RELEASE_NOTES.txt");
  if (!existsSync(notes)) throw new Error(`Fichier de notes introuvable : ${notes}`);

  const releaseDir = path.join(APP_ROOT, "release");
  gh([
    "release", "create", `v${version}`,
    "--repo", GITHUB_REPO,
    "--title", `Nova Storage v${version}`,
    "--notes-file", notes,
    path.join(releaseDir, "latest.yml"),
    path.join(releaseDir, INSTALLER_NAME),
    path.join(releaseDir, BLOCKMAP_NAME),
  ]);
  console.log(`✅ GitHub Release v${version} créée : https://github.com/${GITHUB_REPO}/releases/tag/v${version}`);

  // Vérification finale
  gh(["release", "view", `v${version}`, "--repo", GITHUB_REPO, "--json", "isDraft,isPrerelease,assets",
    "--jq", `{draft: .isDraft, prerelease: .isPrerelease, assets: [.assets[].name]}`]);
}

// --- Main ----------------------------------------------------------------------------
console.log(`Nova Storage — release v${version}${dryRun ? " (DRY RUN)" : ""}`);
console.log(`  app  : ${APP_ROOT}`);
console.log(`  site : ${SITE_DIR}`);
console.log(`  livr : ${RELEASE_DIR}`);

const problems = preflight();
if (problems.length > 0) {
  console.error("");
  console.error("❌ Pré-vol échoué :");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("✅ Pré-vol OK.");

// Avertissement si les notes de version ne mentionnent pas la nouvelle version
try {
  const notes = readFileSync(path.join(APP_ROOT, "release-docs", "RELEASE_NOTES.txt"), "utf8");
  if (!new RegExp(`Version\\s*:?\\s*${version}`).test(notes)) {
    console.warn(`⚠️  release-docs/RELEASE_NOTES.txt ne mentionne pas encore la version ${version} — pensez à la mettre à jour.`);
  }
} catch {
  /* silencieux */
}

if (dryRun) {
  printPlan();
  console.log("Aucune modification effectuée (--dry-run).");
  process.exit(0);
}

// 1. Bump
const pkgPath = path.join(APP_ROOT, "package.json");
let pkg = readFileSync(pkgPath, "utf8");
const currentVersion = readJson(pkgPath).version;
if (currentVersion !== version) {
  pkg = pkg.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`);
  writeFileSync(pkgPath, pkg);
  console.log(`✅ package.json : v${currentVersion} → v${version}`);
} else {
  console.log(`ℹ️  package.json est déjà en v${version} (reprise de release ?)`);
}

// 2-3. Qualité puis build
sh("npm run typecheck && npm test");
sh("npm run dist");

// 4. Vérification des artefacts
verifyArtifacts();

// 5. Livrable
regenerateDeliverables();

// 6-7. Site
publishSite();

// 8. Commit + push
pushAppAndSite();

// 9. GitHub Release
publishGithubRelease();

// Vérification finale du site (hashes identiques)
try {
  sh(`node scripts/release.mjs "${RELEASE_DIR}" --check`, { cwd: SITE_DIR });
  console.log("✅ public/downloads/ identique au livrable (hashes).");
} catch {
  console.error("⚠️  Vérification des hashes du site en échec — vérifier manuellement.");
}

console.log("");
console.log("══════════════════════════════════════════════════════════════");
console.log(`  RELEASE v${version} TERMINÉE`);
console.log(`  GitHub : https://github.com/${GITHUB_REPO}/releases/tag/v${version}`);
console.log("══════════════════════════════════════════════════════════════");
