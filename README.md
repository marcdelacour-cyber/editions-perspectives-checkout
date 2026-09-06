# Éditions Perspectives — Checkout sécurisé

Ce dépôt contient uniquement la petite partie serveur qui crée les sessions Stripe Checkout.

## Principe de sécurité

Le site public **n'envoie jamais de prix** au serveur. Il envoie seulement :

```json
{
  "items": [
    { "id": "feedback", "quantity": 2 },
    { "id": "jugement", "quantity": 1 }
  ]
}
```

Le serveur connaît lui-même les prix :

- `feedback` → **18,00 €**
- `jugement` → **24,00 €**
- `imprevu` → **30,00 €**

Il recalcule ensuite les frais de livraison selon la règle retenue :

- sous-total des livres **< 35 €** → **3,00 €**
- sous-total des livres **≥ 35 €** → **0,01 €**

Le client ne peut donc pas imposer un prix différent en modifiant le JavaScript de son navigateur.

## Fichiers

- `api/create-checkout-session.js` : création sécurisée de la session Stripe
- `api/health.js` : test simple du service
- `index.html` : page technique minimale
- `package.json` : description du projet

## Variables d'environnement à créer dans Vercel

Dans **Project → Settings → Environment Variables** :

### Obligatoire

`STRIPE_SECRET_KEY`

Mettre d'abord une **clé secrète de test Stripe** (`sk_test_...`).
Ne jamais placer cette clé dans GitHub, dans le site public ou dans un fichier HTML.

### Recommandé

`ALLOWED_ORIGINS`

Valeur :

```text
https://editions-perspectives.fr,https://www.editions-perspectives.fr
```

`SITE_URL`

Valeur :

```text
https://editions-perspectives.fr
```

### Facultatif

`SUCCESS_URL`

Par défaut :

```text
https://editions-perspectives.fr/merci.html?session_id={CHECKOUT_SESSION_ID}
```

`CANCEL_URL`

Par défaut :

```text
https://editions-perspectives.fr/?paiement=annule
```

## Test après déploiement

Ouvrir :

```text
https://VOTRE-PROJET.vercel.app/api/health
```

La réponse attendue est :

```json
{"ok":true,"service":"editions-perspectives-checkout"}
```

## Livraison

Cette première version collecte une adresse de livraison en **France uniquement**.

L'international et les territoires dont les frais postaux doivent être traités séparément seront ajoutés après fixation des tarifs correspondants.

## Quantités

Le panier accepte plusieurs exemplaires identiques ou différents.

Par sécurité anti-abus, le code limite actuellement à :

- 20 exemplaires d'un même titre par commande ;
- 50 livres au total.

Ces valeurs sont très faciles à modifier si nécessaire.

## Étape suivante

Une fois le backend déployé et testé, le site `editions-perspectives.fr` recevra :

1. un panier visuel ;
2. des boutons **Ajouter au panier** sur les trois pages livres ;
3. un bouton **Passer commande** qui appelle `/api/create-checkout-session`;
4. une redirection vers l'URL Stripe renvoyée par le serveur.
