/**
 * Éditions Perspectives — création sécurisée d'une session Stripe Checkout
 *
 * Le navigateur n'envoie JAMAIS de prix.
 * Il envoie seulement des identifiants de livres et des quantités.
 * Les prix et les frais de livraison sont recalculés ici, côté serveur.
 */

const CATALOGUE = Object.freeze({
  feedback: {
    name: "Le Feedback en danse",
    unitAmount: 1800, // 18,00 € TTC
  },
  jugement: {
    name: "Le jugement en danse",
    unitAmount: 2400, // 24,00 € TTC
  },
  imprevu: {
    name: "Prévoir l’imprévu ?",
    unitAmount: 3000, // 30,00 € TTC
  },
});

const FREEISH_SHIPPING_THRESHOLD = 3500; // 35,00 € de livres
const SHIPPING_BELOW_THRESHOLD = 300;    // 3,00 €
const SHIPPING_FROM_THRESHOLD = 1;       // 0,01 €

// Bornes anti-abus. Elles n'empêchent pas d'acheter plusieurs exemplaires.
const MAX_QTY_PER_TITLE = 20;
const MAX_TOTAL_BOOKS = 50;

function getAllowedOrigins() {
  const fromEnv = process.env.ALLOWED_ORIGINS;
  const fallback = [
    "https://editions-perspectives.fr",
    "https://www.editions-perspectives.fr",
  ];
  return new Set(
    (fromEnv ? fromEnv.split(",") : fallback)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function setCors(req, res) {
  const origin = req.headers.origin;
  const allowed = getAllowedOrigins();

  if (origin && allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeCart(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Panier vide.");
  }

  const quantities = new Map();

  for (const item of items) {
    if (!item || typeof item !== "object") {
      throw new Error("Article invalide.");
    }

    const id = String(item.id || "");
    const quantity = Number(item.quantity);

    if (!Object.prototype.hasOwnProperty.call(CATALOGUE, id)) {
      throw new Error("Référence inconnue.");
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_TITLE) {
      throw new Error("Quantité invalide.");
    }

    const newQty = (quantities.get(id) || 0) + quantity;
    if (newQty > MAX_QTY_PER_TITLE) {
      throw new Error("Quantité maximale dépassée pour un titre.");
    }
    quantities.set(id, newQty);
  }

  const totalBooks = [...quantities.values()].reduce((sum, q) => sum + q, 0);
  if (totalBooks > MAX_TOTAL_BOOKS) {
    throw new Error("Quantité totale maximale dépassée.");
  }

  return [...quantities.entries()].map(([id, quantity]) => ({ id, quantity }));
}

function addStripeLineItem(params, index, product, quantity) {
  params.append(`line_items[${index}][price_data][currency]`, "eur");
  params.append(
    `line_items[${index}][price_data][product_data][name]`,
    product.name
  );
  params.append(
    `line_items[${index}][price_data][product_data][description]`,
    "Livre papier — Éditions Perspectives"
  );
  params.append(
    `line_items[${index}][price_data][unit_amount]`,
    String(product.unitAmount)
  );
  params.append(`line_items[${index}][quantity]`, String(quantity));
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const origin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();

  // Pour le site public, on exige une origine autorisée.
  // Cela ne remplace pas les contrôles de prix : ceux-ci sont faits côté serveur.
  if (!origin || !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: "Origine non autorisée." });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("STRIPE_SECRET_KEY manquante.");
    return res.status(500).json({ error: "Configuration de paiement incomplète." });
  }

  try {
    const body = parseBody(req);
    if (!body) {
      return res.status(400).json({ error: "Corps JSON invalide." });
    }

    const cart = normalizeCart(body.items);

    let booksSubtotal = 0;
    for (const { id, quantity } of cart) {
      booksSubtotal += CATALOGUE[id].unitAmount * quantity;
    }

    const shippingAmount =
      booksSubtotal >= FREEISH_SHIPPING_THRESHOLD
        ? SHIPPING_FROM_THRESHOLD
        : SHIPPING_BELOW_THRESHOLD;

    const siteUrl =
      (process.env.SITE_URL || "https://editions-perspectives.fr").replace(/\/+$/, "");

    const successUrl =
      process.env.SUCCESS_URL ||
      `${siteUrl}/merci.html?session_id={CHECKOUT_SESSION_ID}`;

    const cancelUrl =
      process.env.CANCEL_URL ||
      `${siteUrl}/?paiement=annule`;

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("locale", "fr");
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);
    params.append("billing_address_collection", "required");
    params.append("phone_number_collection[enabled]", "true");
    params.append("submit_type", "pay");

    // Version initiale : livraison réservée à la France.
    // Nous traiterons l'international séparément lorsque les tarifs seront fixés.
    params.append("shipping_address_collection[allowed_countries][0]", "FR");

    cart.forEach(({ id, quantity }, index) => {
      addStripeLineItem(params, index, CATALOGUE[id], quantity);
    });

    // Les frais sont calculés côté serveur à partir du sous-total des livres.
    params.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
    params.append(
      "shipping_options[0][shipping_rate_data][fixed_amount][amount]",
      String(shippingAmount)
    );
    params.append(
      "shipping_options[0][shipping_rate_data][fixed_amount][currency]",
      "eur"
    );
    params.append(
      "shipping_options[0][shipping_rate_data][display_name]",
      booksSubtotal >= FREEISH_SHIPPING_THRESHOLD
        ? "Livraison — seuil de 35 € atteint"
        : "Livraison"
    );

    params.append("metadata[source]", "editions-perspectives.fr");
    params.append("metadata[books_subtotal_cents]", String(booksSubtotal));
    params.append("metadata[shipping_cents]", String(shippingAmount));

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const stripeData = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error("Erreur Stripe:", {
        status: stripeResponse.status,
        type: stripeData?.error?.type,
        code: stripeData?.error?.code,
        message: stripeData?.error?.message,
      });
      return res.status(502).json({
        error: "Impossible de créer la page de paiement pour le moment.",
      });
    }

    if (!stripeData.url) {
      console.error("Stripe n'a pas renvoyé d'URL Checkout.");
      return res.status(502).json({
        error: "Réponse de paiement incomplète.",
      });
    }

    return res.status(200).json({ url: stripeData.url });
  } catch (error) {
    console.error("Erreur checkout:", error?.message || error);
    return res.status(400).json({
      error: error?.message || "Commande invalide.",
    });
  }
};
