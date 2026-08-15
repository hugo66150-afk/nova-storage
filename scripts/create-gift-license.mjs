#!/usr/bin/env node
/**
 * NOVA STORAGE — Outil ADMIN (développeur uniquement, jamais embarqué).
 *
 * Crée une licence gratuite Nova Pro via l'API Lemon Squeezy. Les licences
 * gratuites (PRO_GIFT / PRO_TEST / PRO_INTERNAL) sont de VRAIES licences
 * Lemon Squeezy : elles s'activent et se valident exactement comme une
 * licence achetée et donnent les mêmes droits Nova Pro.
 *
 * Prérequis :
 *   - LEMON_SQUEEZY_API_KEY (clé d'API admin Lemon Squeezy) en variable
 *     d'environnement. Elle ne doit JAMAIS être commitée ni embarquée dans
 *     l'application (elle n'est utilisée que par cet outil backend).
 *   - Les identifiants du produit Nova Pro. Deux conventions sont acceptées
 *     (le site Nova Storage utilise la forme préfixée) :
 *       PRODUCT_ID / VARIANT_ID  (forme courte)
 *       LEMON_SQUEEZY_PRODUCT_ID / LEMON_SQUEEZY_VARIANT_ID  (forme site)
 *
 * Usage :
 *   LEMON_SQUEEZY_API_KEY=xxx LEMON_SQUEEZY_PRODUCT_ID=123 LEMON_SQUEEZY_VARIANT_ID=456 \
 *     node scripts/create-gift-license.mjs --name "Prénom Nom" --email "ami@exemple.fr" --type PRO_GIFT
 *
 * Types : PRO_PURCHASE (payée) | PRO_GIFT (offerte) | PRO_TEST (test) |
 *         PRO_INTERNAL (équipe) — voir src/shared/monetization.ts.
 */

const API = "https://api.lemonsqueezy.com/v1/licenses";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);

const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
// Les deux conventions d'environnement sont acceptées (forme courte ou
// forme préfixée utilisée par l'outillage admin du site Nova Storage).
const productId = process.env.LEMON_SQUEEZY_PRODUCT_ID || process.env.PRODUCT_ID || args.product_id;
const variantId = process.env.LEMON_SQUEEZY_VARIANT_ID || process.env.VARIANT_ID || args.variant_id;

if (!apiKey) {
  console.error("ERREUR : LEMON_SQUEEZY_API_KEY manquante.");
  console.error("La clé d'API admin se renseigne en variable d'environnement — jamais dans le code.");
  process.exit(1);
}
if (!productId || !variantId) {
  console.error(
    "ERREUR : les identifiants du produit sont requis — LEMON_SQUEEZY_PRODUCT_ID/LEMON_SQUEEZY_VARIANT_ID" +
      " (ou PRODUCT_ID/VARIANT_ID, ou --product_id/--variant_id).",
  );
  process.exit(1);
}
if (!args.name) {
  console.error("ERREUR : --name est requis (nom de la licence).");
  process.exit(1);
}

const body = {
  product_id: Number(productId),
  variant_id: Number(variantId),
  name: `${args.type || "PRO_GIFT"} — ${args.name}`,
  email: args.email || null,
  status: "active",
};

try {
  const res = await fetch(`${API}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
    body: JSON.stringify({ data: { type: "licenses", attributes: body } }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error("Échec de la création de la licence :", res.status, JSON.stringify(json.errors ?? json));
    process.exit(1);
  }
  const key = json.data?.attributes?.key;
  console.log("Licence gratuite créée avec succès ✓");
  console.log(`  Type        : ${args.type || "PRO_GIFT"}`);
  console.log(`  Nom         : ${args.name}`);
  console.log(`  Email       : ${args.email ?? "(aucun)"}`);
  console.log(`  Clé licence : ${key}`);
  console.log("");
  console.log("À transmettre à l'utilisateur : dans Nova Storage → Paramètres → Nova Pro →");
  console.log("« Activer une licence » puis coller la clé.");
} catch (err) {
  console.error("Erreur réseau :", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
