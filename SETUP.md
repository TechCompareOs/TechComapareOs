# TechCompare OS: PayFast + Courier Guy setup

## 1. Database
Supabase > SQL Editor: run `payments.sql` (after `setup.sql`).

## 2. Secrets (Supabase > Edge Functions > Secrets, or CLI)
```
supabase secrets set \
  PAYFAST_MERCHANT_ID=10000100 \
  PAYFAST_MERCHANT_KEY=46f0cd694581a \
  PAYFAST_PASSPHRASE=your-passphrase \
  PAYFAST_SANDBOX=true \
  SHIPLOGIC_TOKEN=your-courier-guy-shiplogic-token \
  SITE_URL=https://YOURNAME.github.io/YOUR-REPO \
  SITE_ORIGIN=https://YOURNAME.github.io \
  PLATFORM_FEE_PERCENT=5
```
(10000100 / 46f0cd694581a are PayFast's public sandbox test credentials. Use your own live ones when you go live and set `PAYFAST_SANDBOX=false`.)

## 3. Deploy
```
supabase functions deploy courier-rates
supabase functions deploy create-payment
supabase functions deploy payfast-itn --no-verify-jwt
```
Copy the `supabase/` folder from this download into your project first.

## 4. Website
Upload `checkout.js` next to `app.js`, then in `index.html` after app.js:
```html
<script src="checkout.js"></script>
<script>
  TechCheckout.init(YOUR_SUPABASE_CLIENT);   // the variable your app.js already uses
  TechCheckout.handleReturn();
</script>
```
Buttons: `TechCheckout.buy(product)` on a listing, `TechCheckout.sellerSetup()` for sellers.

## 5. Test in sandbox before going live
- Sandbox needs split payments enabled on the sandbox account and the seller merchant ID must be a valid sandbox merchant.
- Check the PayFast signature passes (if you get "signature mismatch", the `setup` field position in `create-payment` is the first thing to adjust).
- Check one rate and one shipment succeed against your Ship Logic sandbox token.
