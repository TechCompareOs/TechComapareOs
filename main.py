"""
TechCompare OS payments API (FastAPI).
  POST /courier-rates   live Courier Guy (Ship Logic) rates for a listing + delivery address
  POST /create-payment  creates the order + a signed PayFast split-payment form
  POST /payfast-itn     PayFast webhook: verifies payment, marks Sold, books the courier
Run locally:  uvicorn main:app --reload
"""
import hashlib
import hmac
import json
import os
import re
import urllib.parse
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

# ---------------------------------------------------------------- setup
app = FastAPI(title="TechCompare OS payments")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("SITE_ORIGIN", "*")],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["authorization", "content-type"],
)
http = httpx.AsyncClient(timeout=25)
SHIPLOGIC = "https://api.shiplogic.com/v2"
PROVINCES = ["Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo",
             "Mpumalanga", "Northern Cape", "North West", "Western Cape"]
UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message, self.status = message, status


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError):
    return JSONResponse({"error": exc.message}, status_code=exc.status)


@app.exception_handler(Exception)
async def unexpected_error_handler(_: Request, exc: Exception):
    print("Unexpected error:", repr(exc))
    return JSONResponse({"error": "Something went wrong. Please try again."}, status_code=500)


def env(key: str, default: str | None = None) -> str:
    v = os.environ.get(key, default)
    if not v:
        raise RuntimeError(f"Missing environment variable: {key}")
    return v


@app.get("/")
async def health():
    return {"ok": True}


# ---------------------------------------------------------------- Supabase
def _sb_headers(prefer: str | None = None) -> dict:
    key = env("SUPABASE_SERVICE_ROLE_KEY").strip()
    h = {"apikey": key, "Content-Type": "application/json"}
    if not key.startswith("sb_secret_"):  # new-style secret keys are not JWTs, so they go in apikey only
        h["Authorization"] = f"Bearer {key}"
    if prefer:
        h["Prefer"] = prefer
    return h


async def sb(method: str, table: str, params: dict | None = None, body=None, prefer: str | None = None):
    r = await http.request(method, f"{env('SUPABASE_URL')}/rest/v1/{table}",
                           params=params, json=body, headers=_sb_headers(prefer))
    if r.status_code >= 300:
        print("Supabase error", r.status_code, r.text[:300])
        raise ApiError(f"Database error ({r.status_code}) on '{table}'. Check the Render logs.", 500)
    return r.json() if r.content else []


async def current_buyer(request: Request) -> str:
    """Verify the Supabase login token and return the student's email."""
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise ApiError("Please sign in first", 401)
    r = await http.get(f"{env('SUPABASE_URL')}/auth/v1/user",
                       headers={"apikey": env("SUPABASE_ANON_KEY"), "Authorization": auth})
    if r.status_code != 200:
        raise ApiError("Your session expired, please sign in again", 401)
    email = (r.json().get("email") or "").lower()
    if not re.search(r"@(tut4life\.ac\.za|tut\.ac\.za)$", email):
        raise ApiError("Only verified TUT students can buy", 403)
    return email


# ---------------------------------------------------------------- PayFast
def pf_host() -> str:
    return "www.payfast.co.za" if os.environ.get("PAYFAST_SANDBOX", "true").lower() == "false" \
        else "sandbox.payfast.co.za"


def pf_encode(v: str) -> str:
    # PHP urlencode() style, which is what PayFast expects
    return urllib.parse.quote_plus(v.strip(), safe="").replace("~", "%7E")


def pf_signature(pairs: list[tuple[str, str]], passphrase: str) -> str:
    s = "&".join(f"{k}={pf_encode(v)}" for k, v in pairs if v != "")
    if passphrase:
        s += f"&passphrase={pf_encode(passphrase)}"
    return hashlib.md5(s.encode()).hexdigest()


def money(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


# ---------------------------------------------------------------- Courier Guy (Ship Logic)
async def shiplogic(path: str, body: dict) -> dict:
    r = await http.post(SHIPLOGIC + path, json=body,
                        headers={"Authorization": f"Bearer {env('SHIPLOGIC_TOKEN')}"})
    try:
        data = r.json()
    except Exception:
        data = {}
    if r.status_code >= 300:
        raise RuntimeError(f"Courier Guy {r.status_code}: {json.dumps(data)[:300]}")
    return data


def sl_address(a: dict, kind: str = "residential") -> dict:
    return {"type": kind, "company": "", "street_address": a["street_address"],
            "local_area": a["local_area"], "city": a["city"], "zone": a["province"],
            "country": "ZA", "code": a["postal_code"]}


def parcel_for(category: str | None) -> dict:
    c = (category or "").lower()
    if c.startswith("laptop"):
        l, w, h, kg = 40, 30, 10, 3
    elif c.startswith(("phone", "smartphone")):
        l, w, h, kg = 20, 12, 8, 0.7
    elif c.startswith("tablet"):
        l, w, h, kg = 30, 22, 8, 1.2
    else:
        l, w, h, kg = 30, 30, 15, 3
    return {"submitted_length_cm": l, "submitted_width_cm": w,
            "submitted_height_cm": h, "submitted_weight_kg": kg}


async def quote(seller: dict, delivery: dict, product: dict) -> list[dict]:
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
    try:
        res = await shiplogic("/rates", {
            "collection_address": sl_address(seller),
            "delivery_address": sl_address(delivery),
            "parcels": [parcel_for(product.get("category"))],
            "declared_value": float(product["price"]),
            "collection_min_date": tomorrow,
        })
    except RuntimeError as e:
        print(e)
        raise ApiError("Couldn't get courier rates for that address. Check it and try again.", 502)
    rates = []
    for r in res.get("rates", []):
        sl_level = r.get("service_level") or {}
        amount = float(r.get("rate") or 0)
        if sl_level.get("code") and amount > 0:
            rates.append({"code": sl_level["code"], "name": sl_level.get("name", "Courier"),
                          "amount": amount, "cents": round(amount * 100),
                          "delivery_from": sl_level.get("delivery_date_from")})
    return rates


# ---------------------------------------------------------------- validation + listing
def clean_address(a: dict) -> dict:
    a = a or {}
    out = {k: str(a.get(k, "")).strip()[:100] for k in
           ("street_address", "local_area", "city", "province")}
    out["postal_code"] = str(a.get("postal_code", "")).strip()[:4]
    if not (out["street_address"] and out["local_area"] and out["city"]):
        raise ApiError("Please complete the delivery address")
    if out["province"] not in PROVINCES:
        raise ApiError("Choose a valid province")
    if not re.fullmatch(r"\d{4}", out["postal_code"]):
        raise ApiError("Postal code must be 4 digits")
    return out


async def load_listing(product_id: str, buyer: str):
    rows = await sb("GET", "products", params={"id": f"eq.{product_id}", "select": "*"})
    if not rows:
        raise ApiError("Listing not found", 404)
    p = rows[0]
    expires = p.get("expires_at")
    if p.get("status") != "Available" or (
            expires and datetime.fromisoformat(expires.replace("Z", "+00:00")) < datetime.now(timezone.utc)):
        raise ApiError("This listing is no longer available")
    if not p.get("price") or float(p["price"]) <= 0:
        raise ApiError("This listing has no price")
    seller_email = str(p.get("seller_email") or "").lower()
    if seller_email == buyer:
        raise ApiError("You can't buy your own listing")
    s = await sb("GET", "seller_profiles", params={"seller_email": f"eq.{seller_email}", "select": "*"})
    if not s:
        raise ApiError("This seller hasn't set up payouts yet, so it can't be bought online")
    return p, s[0]


# ---------------------------------------------------------------- routes
@app.post("/courier-rates")
async def courier_rates(request: Request):
    buyer = await current_buyer(request)
    body = await request.json()
    delivery = clean_address(body.get("address"))
    p, s = await load_listing(str(body.get("product_id", "")), buyer)
    rates = await quote(s, delivery, p)
    if not rates:
        raise ApiError("No courier options for that address", 422)
    return {"item_cents": round(float(p["price"]) * 100), "rates": rates}


@app.post("/create-payment")
async def create_payment(request: Request):
    buyer = await current_buyer(request)
    body = await request.json()
    delivery = clean_address(body.get("address"))
    name = str(body.get("name", "")).strip()[:100]
    phone = re.sub(r"[^\d+]", "", str(body.get("phone", "")))[:15]
    if len(name) < 2:
        raise ApiError("Enter your full name")
    if len(phone) < 9:
        raise ApiError("Enter a valid cell number")

    p, s = await load_listing(str(body.get("product_id", "")), buyer)

    # Re-quote on the server so the shipping price can't be tampered with in the browser
    rates = await quote(s, delivery, p)
    rate = next((r for r in rates if r["code"] == body.get("service_level_code")), None)
    if not rate:
        raise ApiError("That delivery option is no longer available, please refresh the rates")

    fee_pct = float(os.environ.get("PLATFORM_FEE_PERCENT", "5"))
    item_cents = round(float(p["price"]) * 100)
    ship_cents = rate["cents"]
    fee_cents = round(item_cents * fee_pct / 100)
    seller_cents = item_cents - fee_cents       # seller gets item price minus platform fee
    total_cents = item_cents + ship_cents       # platform keeps fee + shipping (pays the courier)
    if seller_cents < 100:
        raise ApiError("Price too low for a split payment")

    title = str(p.get("title") or p.get("name") or "TechCompare item")[:100]
    rows = await sb("POST", "orders", prefer="return=representation", body={
        "product_id": str(p["id"]), "product_title": title, "buyer_email": buyer,
        "seller_email": str(p["seller_email"]).lower(), "buyer_name": name, "buyer_phone": phone,
        "delivery_address": delivery, "service_level_code": rate["code"],
        "service_level_name": rate["name"], "item_cents": item_cents, "shipping_cents": ship_cents,
        "fee_cents": fee_cents, "total_cents": total_cents})
    order_id = rows[0]["id"]

    site = env("SITE_URL").rstrip("/")
    first, _, last = name.partition(" ")
    setup = json.dumps({"split_payment": {"merchant_id": int(s["payfast_merchant_id"]),
                                          "amount": seller_cents, "min": 100, "max": seller_cents}},
                       separators=(",", ":"))

    # ORDER MATTERS: PayFast's documented field order (also used for the signature)
    pairs = [
        ("merchant_id", env("PAYFAST_MERCHANT_ID")),
        ("merchant_key", env("PAYFAST_MERCHANT_KEY")),
        ("return_url", f"{site}/index.html?payment=success&order={order_id}"),
        ("cancel_url", f"{site}/index.html?payment=cancelled&order={order_id}"),
        ("notify_url", f"{env('API_PUBLIC_URL').rstrip('/')}/payfast-itn"),
        ("name_first", first), ("name_last", last.strip()),
        ("email_address", buyer), ("cell_number", phone),
        ("m_payment_id", order_id), ("amount", money(total_cents)),
        ("item_name", title), ("item_description", f"Delivery: {rate['name']}"[:255]),
        ("setup", setup),
    ]
    signature = pf_signature(pairs, os.environ.get("PAYFAST_PASSPHRASE", ""))
    return {"action": f"https://{pf_host()}/eng/process",
            "fields": [[k, v] for k, v in pairs if v != ""] + [["signature", signature]],
            "order_id": order_id}


@app.post("/payfast-itn")
async def payfast_itn(request: Request):
    """PayFast calls this server-to-server after every payment. Always answer 200."""
    try:
        raw = (await request.body()).decode()
        params = dict(urllib.parse.parse_qsl(raw, keep_blank_values=True))

        # 1. Signature: rebuild from the raw body in the order PayFast sent it
        parts = [x for x in raw.split("&") if x and not x.startswith("signature=")]
        s = "&".join(parts)
        passphrase = os.environ.get("PAYFAST_PASSPHRASE", "")
        if passphrase:
            s += f"&passphrase={pf_encode(passphrase)}"
        expected = hashlib.md5(s.encode()).hexdigest()
        if not hmac.compare_digest(expected, params.get("signature", "")):
            print("ITN: bad signature")
            return PlainTextResponse("OK")

        # 2. Find the order and check the amount
        order_id = params.get("m_payment_id", "")
        if not UUID_RE.match(order_id) or params.get("merchant_id") != env("PAYFAST_MERCHANT_ID"):
            return PlainTextResponse("OK")
        rows = await sb("GET", "orders", params={"id": f"eq.{order_id}", "select": "*"})
        if not rows:
            return PlainTextResponse("OK")
        o = rows[0]
        paid_cents = round(float(params.get("amount_gross", "0")) * 100)
        if paid_cents != o["total_cents"]:
            print("ITN: amount mismatch", paid_cents, o["total_cents"])
            return PlainTextResponse("OK")

        # 3. Ask PayFast to confirm the notification is genuine
        v = await http.post(f"https://{pf_host()}/eng/query/validate", content=raw,
                            headers={"Content-Type": "application/x-www-form-urlencoded"})
        if v.text.strip() != "VALID":
            print("ITN: PayFast did not validate")
            return PlainTextResponse("OK")

        status = params.get("payment_status")
        if status in ("CANCELLED", "FAILED"):
            await sb("PATCH", "orders", params={"id": f"eq.{o['id']}", "status": "eq.pending"},
                     body={"status": "failed" if status == "FAILED" else "cancelled"})
            return PlainTextResponse("OK")
        if status != "COMPLETE":
            return PlainTextResponse("OK")

        # 4. Mark paid exactly once (PayFast can retry the same ITN)
        claimed = await sb("PATCH", "orders", params={"id": f"eq.{o['id']}", "status": "eq.pending"},
                           prefer="return=representation",
                           body={"status": "paid", "pf_payment_id": params.get("pf_payment_id"),
                                 "paid_at": datetime.now(timezone.utc).isoformat()})
        if not claimed:
            return PlainTextResponse("OK")
        await sb("PATCH", "products", params={"id": f"eq.{o['product_id']}"}, body={"status": "Sold"})

        # 5. Book the Courier Guy collection
        try:
            prod = (await sb("GET", "products", params={"id": f"eq.{o['product_id']}", "select": "category"}))[0]
            seller = (await sb("GET", "seller_profiles",
                               params={"seller_email": f"eq.{o['seller_email']}", "select": "*"}))[0]
            shipment = await shiplogic("/shipments", {
                "collection_address": sl_address(seller),
                "collection_contact": {"name": seller["full_name"], "mobile_number": seller["phone"],
                                       "email": seller["seller_email"]},
                "delivery_address": sl_address(o["delivery_address"]),
                "delivery_contact": {"name": o["buyer_name"], "mobile_number": o["buyer_phone"],
                                     "email": o["buyer_email"]},
                "parcels": [parcel_for(prod.get("category"))],
                "declared_value": o["item_cents"] / 100,
                "service_level_code": o["service_level_code"],
                "customer_reference": o["id"],
                "mute_notifications": False,
            })
            await sb("PATCH", "orders", params={"id": f"eq.{o['id']}"},
                     body={"shipment_id": str(shipment.get("id", "")),
                           "tracking_reference": shipment.get("short_tracking_reference")})
        except Exception as e:  # payment is safe; record the problem so you can book manually
            print("Courier booking failed:", repr(e))
            await sb("PATCH", "orders", params={"id": f"eq.{o['id']}"},
                     body={"courier_error": str(e)[:500]})
    except Exception as e:
        print("ITN error:", repr(e))
    return PlainTextResponse("OK")
