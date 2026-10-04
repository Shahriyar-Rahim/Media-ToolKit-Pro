# Media Toolkit Pro - Backend (v0.1.0)

Node.js + Express + MongoDB (Mongoose). Modular monolith. All secrets live here, never in the desktop app.

## Setup
    cd server && npm install
    cp .env.example .env         # fill MONGODB_URI, JWT_ACCESS_SECRET, OTP_HMAC_SECRET (openssl rand -hex 48)
    npm run keys                 # prints ENTITLEMENT_PRIVATE_KEY / PUBLIC_KEY -> paste into .env; public key also goes in the desktop app
    SEED_ADMIN_EMAIL=you@x.com SEED_ADMIN_PASSWORD='long-password-12+' npm run seed
    npm run dev                  # http://localhost:4000

Without SMTP_HOST the mailer prints codes to the console (development only). In production set SMTP_* and NODE_ENV=production
(the server refuses to start without the secrets). Payments start OFF: enable SSLCommerz/MFS from the admin API.

## SSLCommerz
Set SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWORD (sandbox credentials first, SSLCOMMERZ_IS_SANDBOX=true) and PUBLIC_API_URL to an
HTTPS URL the gateway can reach. Register `${PUBLIC_API_URL}/api/payments/sslcommerz/ipn` as the IPN URL in the SSLCommerz panel.
Flow: POST /api/subscriptions/checkout {planId, method:"SSLCOMMERZ"} -> open redirectUrl in the system browser -> gateway posts to
/success (UX only) and /ipn -> server calls the validation API with val_id, checks status/tran_id/currency/amount, flips
INITIATED->PAID atomically, activates once (unique paymentKey), emails once (unique EmailLog key).
Sandbox-test the full flow before going live: the validation field names were checked against public SDKs, not a live account.

## Manual MFS
Admin adds providers (POST /api/admin/mfs) and enables the MFS gateway. User: quote -> checkout {method:"MFS", providerId} shows
instructions -> POST /api/manual-payments {planId, providerId, transactionId, senderNumber, amount}. Admin approves/rejects at
POST /api/admin/payments/manual/:id/review. Only approval activates. (provider + transactionId) is unique.

## API map
    /api/auth              register, verify-email, resend-verification, login, login/otp, refresh, logout, forgot/reset-password, change-password, me, two-factor
    /api/plans, /api/payments/methods, /api/help/faq, /api/app/status      public
    /api/subscriptions     quote, checkout, mine           /api/manual-payments   submit
    /api/usage             entitlement (+ signed offline snapshot), consume
    /api/bugs, /api/contact                                submit
    /api/admin/*           dashboard, reports, users, plans, discounts, mfs, gateways, payments/{ssl,manual}, settings/:group, faq, bugs, contacts, tickets, audit

## Security model
Passwords bcrypt(12). Sessions: 15-min HttpOnly SameSite=Strict JWT cookie + rotating refresh token (hash stored; replay fails);
password change/reset revokes all. Role and disabled state are read from the DB on every request. OTP: CSPRNG, HMAC-hashed,
single-use, attempt-limited, cooldown, TTL index. Prices/discounts/durations are computed server-side in integer minor units.
Helmet, strict CORS allow-list, per-route rate limits, 100 KB body cap, Zod validation on every input, audit log (secrets redacted).

## Tests
    npm test                                     # 30 logic + HTTP-guard tests, no database needed
    MONGODB_TEST_URI=mongodb://127.0.0.1:27017/mtp_test npm test    # also runs 15 DB integration tests (WIPES that database)

## Known limitations
No admin UI yet (API only). SMTP credentials are environment-only (not editable in the admin UI, by design). No "recent re-auth"
gate on sensitive admin actions. Refunds are recorded manually (no gateway refund call). Screenshot upload for bug reports is not
implemented (log excerpt text only). Multi-instance deployments should keep rate-limit state in a shared store.
