# Éditions Perspectives — Checkout v3 (Stripe TEST)

This version connects the five printed books to the Stripe TEST catalogue via Stripe Price IDs.

- `jugement` — Le jugement en danse — `price_1UCjzvBLF5IwE45Q5BQnFxkU`
- `imprevu` — Prévoir l’imprévu ? — `price_1UCk31BLF5IwE45QYxID469w`
- `feedback` — Le Feedback en danse — `price_1UCkEGBLF5IwE45QVtpCbnpI`
- `judging_en` — Judging in Dance — `price_1UCkHJBLF5IwE45Qb0cDXtTZ`
- `unexpected_en` — When the Unexpected Takes the Floor — `price_1UCkHzBLF5IwE45QMKcA8kI6`

The browser sends only internal references and quantities. The Stripe Price IDs remain in this server-side Vercel function.

Delivery remains restricted to France and is calculated server-side: €3 below €35 of books, €0.01 from €35.

## Vercel environment variable for this test phase

`STRIPE_SECRET_KEY` must be a Stripe **test** secret key (`sk_test_...`).

Optional variables remain supported: `ALLOWED_ORIGINS`, `SITE_URL`, `SUCCESS_URL`, `CANCEL_URL`.

The successful Checkout Session also stores `cart` and `assistant_entitlements` metadata to prepare the later secure delivery of the Judge and Competitor Assistant links.
