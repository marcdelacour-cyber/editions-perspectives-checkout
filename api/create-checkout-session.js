/**
 * Éditions Perspectives — secure Stripe Checkout session creation
 *
 * The browser NEVER sends prices. It sends only product IDs and quantities.
 * Prices and delivery charges are recalculated here, on the server.
 */

const CATALOGUE = Object.freeze({
  feedback:      { name: "Le Feedback en danse", unitAmount: 1800, lang: "fr" },
  jugement:      { name: "Le jugement en danse", unitAmount: 2400, lang: "fr" },
  imprevu:       { name: "Prévoir l’imprévu ?", unitAmount: 3000, lang: "fr" },
  judging_en:    { name: "Judging in Dance", unitAmount: 2400, lang: "en" },
  unexpected_en: { name: "When the Unexpected Takes the Floor", unitAmount: 3000, lang: "en" },
});

const FREEISH_SHIPPING_THRESHOLD = 3500; // €35.00 of books
const SHIPPING_BELOW_THRESHOLD = 300;    // €3.00
const SHIPPING_FROM_THRESHOLD = 1;       // €0.01
const MAX_QTY_PER_TITLE = 20;
const MAX_TOTAL_BOOKS = 50;

function getAllowedOrigins() {
  const fromEnv = process.env.ALLOWED_ORIGINS;
  const fallback = [
    "https://editions-perspectives.fr",
    "https://www.editions-perspectives.fr",
  ];
  return new Set((fromEnv ? fromEnv.split(",") : fallback).map((s) => s.trim()).filter(Boolean));
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
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

function normalizeCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Panier vide / Empty cart.");
  const quantities = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object") throw new Error("Article invalide / Invalid item.");
    const id = String(item.id || "");
    const quantity = Number(item.quantity);
    if (!Object.prototype.hasOwnProperty.call(CATALOGUE, id)) throw new Error("Référence inconnue / Unknown product.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_TITLE) throw new Error("Quantité invalide / Invalid quantity.");
    const newQty = (quantities.get(id) || 0) + quantity;
    if (newQty > MAX_QTY_PER_TITLE) throw new Error("Quantité maximale dépassée / Maximum quantity exceeded.");
    quantities.set(id, newQty);
  }
  const totalBooks = [...quantities.values()].reduce((sum, q) => sum + q, 0);
  if (totalBooks > MAX_TOTAL_BOOKS) throw new Error("Quantité totale maximale dépassée / Maximum total quantity exceeded.");
  return [...quantities.entries()].map(([id, quantity]) => ({ id, quantity }));
}

function addStripeLineItem(params, index, product, quantity) {
  params.append(`line_items[${index}][price_data][currency]`, "eur");
  params.append(`line_items[${index}][price_data][product_data][name]`, product.name);
  params.append(`line_items[${index}][price_data][product_data][description]`, "Printed book — Éditions Perspectives");
  params.append(`line_items[${index}][price_data][unit_amount]`, String(product.unitAmount));
  params.append(`line_items[${index}][quantity]`, String(quantity));
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Méthode non autorisée / Method not allowed." });
  }

  const origin = req.headers.origin;
  if (!origin || !getAllowedOrigins().has(origin)) return res.status(403).json({ error: "Origine non autorisée / Origin not allowed." });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: "Configuration de paiement incomplète / Payment configuration incomplete." });

  try {
    const body = parseBody(req);
    if (!body) return res.status(400).json({ error: "Corps JSON invalide / Invalid JSON body." });
    const cart = normalizeCart(body.items);

    let booksSubtotal = 0;
    for (const { id, quantity } of cart) booksSubtotal += CATALOGUE[id].unitAmount * quantity;
    const shippingAmount = booksSubtotal >= FREEISH_SHIPPING_THRESHOLD ? SHIPPING_FROM_THRESHOLD : SHIPPING_BELOW_THRESHOLD;

    const allEnglish = cart.every(({id}) => CATALOGUE[id].lang === "en");
    const siteUrl = (process.env.SITE_URL || "https://editions-perspectives.fr").replace(/\/+$/, "");
    const successUrl = process.env.SUCCESS_URL || `${siteUrl}/${allEnglish ? "merci-en.html" : "merci.html"}?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = process.env.CANCEL_URL || `${siteUrl}/${allEnglish ? "index-en.html?payment=cancelled" : "?paiement=annule"}`;

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("locale", allEnglish ? "en" : "fr");
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);
    params.append("billing_address_collection", "required");
    params.append("phone_number_collection[enabled]", "true");
    params.append("submit_type", "pay");
    params.append("shipping_address_collection[allowed_countries][0]", "FR");

    cart.forEach(({ id, quantity }, index) => addStripeLineItem(params, index, CATALOGUE[id], quantity));

    params.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
    params.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(shippingAmount));
    params.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "eur");
    params.append("shipping_options[0][shipping_rate_data][display_name]", booksSubtotal >= FREEISH_SHIPPING_THRESHOLD
      ? (allEnglish ? "Delivery — €35 threshold reached" : "Livraison — seuil de 35 € atteint")
      : (allEnglish ? "Delivery" : "Livraison"));

    params.append("metadata[source]", "editions-perspectives.fr");
    params.append("metadata[books_subtotal_cents]", String(booksSubtotal));
    params.append("metadata[shipping_cents]", String(shippingAmount));
    params.append("metadata[language]", allEnglish ? "en" : "fr");

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
      console.error("Stripe error:", { status: stripeResponse.status, type: stripeData?.error?.type, code: stripeData?.error?.code, message: stripeData?.error?.message });
      return res.status(502).json({ error: "Impossible de créer la page de paiement / Unable to create payment page." });
    }
    if (!stripeData.url) return res.status(502).json({ error: "Réponse de paiement incomplète / Incomplete payment response." });
    return res.status(200).json({ url: stripeData.url });
  } catch (error) {
    console.error("Checkout error:", error?.message || error);
    return res.status(400).json({ error: error?.message || "Commande invalide / Invalid order." });
  }
};
