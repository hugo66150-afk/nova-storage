# Nova Storage — Configuration commerciale réelle (Lemon Squeezy)

> **État actuel : architecture prête, compte externe NON encore renseigné.**
> Aucune URL de checkout n'est configurée : les boutons d'achat affichent
> honnêtement « bientôt disponible » et aucun paiement n'est simulé.
> Ce document explique exactement quoi renseigner et comment tester.

## 0. Source de vérité unique

Tout le modèle commercial vit dans un seul fichier :
**`src/shared/monetization.ts`** (`MONETIZATION`).

- Le prix (9,97 €), la devise (EUR) et la durée d'essai (7 j) y sont définis
  une seule fois.
- Le site web **Nova Storage** et l'application doivent pointer vers **la
  même URL de checkout Lemon Squeezy** (même produit, même prix, même
  système de licences). Il n'existe qu'UN produit Nova Pro, qu'UN checkout,
  qu'UNE source de vérité de licences : Lemon Squeezy.
- Aucun secret ne figure dans ce fichier ni dans l'application. La clé
  d'API admin Lemon Squeezy ne vit que dans l'outillage backend (variables
  d'environnement).

## 1. Créer le produit dans Lemon Squeezy (une seule fois)

1. Ouvrir le dashboard Lemon Squeezy → **Products**.
2. Créer un produit **Nova Pro** :
   - type : **one-time purchase** (paiement unique, pas d'abonnement) ;
   - prix : **9,97 €** ;
   - activer **License keys** pour ce produit (Lemon Squeezy génère et
     gère les clés).
3. Récupérer, dans l'URL du produit / l'interface :
   - **Store ID**,
   - **Product ID**,
   - **Variant ID**,
   - l'**URL de checkout** (le lien « Buy » du variant, format
     `https://store.lemonsqueezy.com/checkout/buy/...`).
4. Le site web Nova Storage doit utiliser **exactement la même URL de
   checkout** que l'application (vérifier que le bouton du site pointe vers
   ce même lien).

## 2. Configuration ACTUELLE (identifiants réels renseignés)

Dans `src/shared/monetization.ts` — valeurs officielles déjà en place :

```ts
payment: {
  storeId: "novastorage",                    // slug public du store
  productId: "1292367",
  variantId: "2022137",
  checkoutUrl: "https://novastorage.lemonsqueezy.com/checkout/buy/18829073-b7bc-4459-84c6-13ee2874c8a7",
  licenseApiUrl: "https://api.lemonsqueezy.com/v1/licenses/validate",
  activateApiUrl: "https://api.lemonsqueezy.com/v1/licenses/activate",
}
```

Effet : `checkoutReady()` est vrai → le bouton « Acheter Nova Pro · 9,97 € »
est actif (Paramètres et modale Pro) et ouvre le checkout officiel dans le
navigateur Windows.

> Le store est actuellement en attente d'activation par Lemon Squeezy :
> l'application est PRÊTE, mais un vrai paiement ne sera testé qu'une fois
> le store activé. Le Pro ne se débloque toujours que par validation réelle
> d'une licence (jamais par l'ouverture du checkout).

> La validation d'URL est centralisée (`validateCheckoutUrl`) : seule une
> URL `https://` explicite peut être ouverte. Testée (tests/checkout.test.ts)
> et le checkout réel ci-dessus est accepté par elle.

## 3. Reconstruire le build commercial

```bash
npm run typecheck && npm test && npm run build && npm run dist
```

Les artefacts sont générés dans `release/` :
- `Nova-Storage-Setup-x64.exe` (installateur NSIS, nom fixe aligné sur le site) ;
- `latest.yml` + `Nova-Storage-Setup-x64.exe.blockmap` (auto-update electron-updater,
  à publier avec l'installateur sur le site).

## 4. Premier vrai achat — procédure de test (J)

1. Lancer l'application packagée.
2. Paramètres → **Nova Pro** → « Acheter Nova Pro · 9,97 € ».
3. Le navigateur Windows s'ouvre sur le checkout Lemon Squeezy (HTTPS).
   Le paiement se déroule entièrement chez Lemon Squeezy — Nova ne voit
   aucune donnée bancaire.
4. Une fois le paiement effectué, Lemon Squeezy affiche/remet la **clé de
   licence** (et l'envoie par email selon la configuration du produit).
5. Revenir dans Nova → Paramètres → **Nova Pro** → champ « Activer une
   licence » → coller la clé → « Activer Nova Pro ».
6. Le Pro s'active **immédiatement** (aucun redémarrage) : message
   « ✨ Nova Pro est activé. », badge Pro, fonctions Pro déverrouillées.

> Ne jamais considérer le retour du checkout comme une preuve de paiement :
> seule l'activation de la clé (validée par l'API Lemon Squeezy) débloque
> le Pro.

## 5. Tester l'activation (K)

Cas à tester manuellement, dans Paramètres → Nova Pro :

| Cas | Résultat attendu |
|---|---|
| Clé vide | « Veuillez saisir votre clé de licence. » |
| Clé inconnue | « Cette licence n'est pas valide. Vérifiez votre clé puis réessayez. » |
| Clé révoquée | « Cette licence a été révoquée… » (statut `license_revoked`) |
| Clé expirée | « Cette licence a expiré. » |
| Clé déjà activée ailleurs | « Cette licence a déjà été activée sur un autre poste… » |
| Réseau coupé à l'activation | Message hors ligne, rien n'est stocké |
| API lente (> 10 s) | « Le serveur de licence met trop de temps à répondre… » |
| Hors ligne après activation | Nova reste Pro (grâce 30 jours), puis « non vérifiée » |

Vérifications de persistance :
- Fermer et relancer Nova → le statut Pro est conservé (base SQLite du
  profil utilisateur).
- Désinstaller puis réinstaller (données conservées) → « Restaurer ma
  licence » revalide la clé et retrouve le Pro sans nouvel achat.

## 5 bis. Référence commerciale : le site Nova Storage

Le site officiel (`Nova Site`, déployé sur Vercel) est la référence actuelle
du checkout : sa configuration vit dans `src/lib/site.ts`
(`lemonSqueezyConfig`, `pricingConfig`). État actuel : **les deux projets sont
alignés et tous deux non configurés** (checkoutUrl null/vide des deux côtés,
prix 9,97 €, essai 7 jours, même produit/licences Lemon Squeezy). Lors de la
création du produit, renseigner la MÊME URL de checkout dans `site.ts` (côté
site) et dans `MONETIZATION.payment.checkoutUrl` (côté application). La page
`/merci` du site dirige vers « Paramètres → Nova Pro → Activer une licence »,
exactement l'écran implémenté dans l'application.

L'outillage admin du site (routes API `/admin/...`) utilise les variables
`LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_STORE_ID`, `LEMON_SQUEEZY_VARIANT_ID`.
Le script de l'application accepte les deux conventions (forme courte
`PRODUCT_ID`/`VARIANT_ID` et forme préfixée du site).

## 6. Créer une licence gratuite (L)

Les licences gratuites (PRO_GIFT / PRO_TEST / PRO_INTERNAL) sont de
**vraies licences Lemon Squeezy**, créées depuis un environnement sécurisé
— jamais depuis l'application distribuée.

```bash
# Variables d'environnement (jamais commitées) :
#   LEMON_SQUEEZY_API_KEY = clé d'API admin (dashboard Lemon Squeezy → Settings → API)
#   Les identifiants du produit Nova Pro (cf. §1) : forme courte ou préfixée.
LEMON_SQUEEZY_API_KEY=xxx LEMON_SQUEEZY_PRODUCT_ID=1292367 LEMON_SQUEEZY_VARIANT_ID=2022137 \
  node scripts/create-gift-license.mjs --name "Prénom Nom" --email "ami@exemple.fr" --type PRO_GIFT
```

La clé générée s'active dans Nova exactement comme une licence achetée et
donne les mêmes droits Pro.

## 7. Revalidation et hors ligne

- Une licence activée est revalidée auprès de l'API Lemon Squeezy au plus
  une fois par jour (si connecté) et au démarrage.
- Hors ligne : aucune désactivation brutale. La licence reste active
  pendant la période de grâce (30 j), puis passe en « non vérifiée » avec
  le message : « Impossible de vérifier votre licence pour le moment. Nova
  continue de fonctionner hors ligne. »
- Une révocation réelle n'est appliquée qu'après une validation réseau
  fiable.
- **Nova Free ne dépend jamais du réseau ni de Lemon Squeezy.**

## 8. Rappels honnêtes

- Tant que `checkoutUrl` est vide, **aucun** bouton de paiement fonctionnel
  n'existe et rien n'est présenté comme disponible.
- La signature de code Windows est un prérequis séparé — voir `SIGNING.md`
  (actuellement : non signé).
- Le prix ne se modifie qu'à un seul endroit : `MONETIZATION.pricing`.
