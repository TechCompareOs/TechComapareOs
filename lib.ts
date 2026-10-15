import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

export const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing secret: ${k}`);
  return v;
};

export const admin = () =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

// Returns the signed-in user from the request's JWT, or null
export async function getUser(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const c = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } },
  });
  const { data } = await c.auth.getUser();
  return data.user ?? null;
}

export const isTut = (email: string) =>
  /@(tut4life\.ac\.za|tut\.ac\.za)$/i.test(email);

// ---------- PayFast ----------
export const PF_HOST = () =>
  Deno.env.get("PAYFAST_SANDBOX") === "false" ? "www.payfast.co.za" : "sandbox.payfast.co.za";

// PHP urlencode() style, which is what PayFast expects
export const pfEncode = (v: string) =>
  encodeURIComponent(v.trim())
    .replace(/%20/g, "+")
    .replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export async function md5(s: string) {
  return encodeHex(await crypto.subtle.digest("MD5", new TextEncoder().encode(s)));
}

// pairs MUST be in PayFast's documented field order
export async function pfSignature(pairs: [string, string][], passphrase: string) {
  let s = pairs
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k}=${pfEncode(v)}`)
    .join("&");
  if (passphrase) s += `&passphrase=${pfEncode(passphrase)}`;
  return md5(s);
}

// ---------- Courier Guy (Ship Logic) ----------
const SL = "https://api.shiplogic.com/v2";

export async function sl(path: string, body: unknown) {
  const r = await fetch(SL + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("SHIPLOGIC_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Courier Guy ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

export const slAddress = (a: any, type = "residential") => ({
  type,
  company: "",
  street_address: a.street_address,
  local_area: a.local_area,
  city: a.city,
  zone: a.province,
  country: "ZA",
  code: a.postal_code,
});

// Default parcel sizes by category (cm / kg)
export function parcelFor(category?: string) {
  const c = (category ?? "").toLowerCase();
  const p = c.startsWith("laptop")
    ? [40, 30, 10, 3]
    : c.startsWith("phone") || c.startsWith("smartphone")
    ? [20, 12, 8, 0.7]
    : c.startsWith("tablet")
    ? [30, 22, 8, 1.2]
    : [30, 30, 15, 3];
  return {
    submitted_length_cm: p[0],
    submitted_width_cm: p[1],
    submitted_height_cm: p[2],
    submitted_weight_kg: p[3],
  };
}

const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);

export async function quote(seller: any, delivery: any, product: any) {
  const res = await sl("/rates", {
    collection_address: slAddress(seller),
    delivery_address: slAddress(delivery),
    parcels: [parcelFor(product.category)],
    declared_value: Number(product.price),
    collection_min_date: tomorrow(),
  });
  return (res.rates ?? [])
    .map((r: any) => ({
      code: r.service_level?.code as string,
      name: r.service_level?.name as string,
      amount: Number(r.rate),
      delivery_from: r.service_level?.delivery_date_from ?? null,
    }))
    .filter((r: any) => r.code && r.amount > 0);
}

// ---------- validation ----------
export const PROVINCES = [
  "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo",
  "Mpumalanga", "Northern Cape", "North West", "Western Cape",
];

export function cleanAddress(a: any) {
  const f = (k: string, max = 100) => String(a?.[k] ?? "").trim().slice(0, max);
  const out = {
    street_address: f("street_address"),
    local_area: f("local_area"),
    city: f("city"),
    province: f("province"),
    postal_code: f("postal_code", 4),
  };
  if (!out.street_address || !out.local_area || !out.city) throw new Error("Please complete the delivery address");
  if (!PROVINCES.includes(out.province)) throw new Error("Choose a valid province");
  if (!/^\d{4}$/.test(out.postal_code)) throw new Error("Postal code must be 4 digits");
  return out;
}

export async function loadListing(db: any, productId: string, buyerEmail: string) {
  const { data: p } = await db.from("products").select("*").eq("id", productId).maybeSingle();
  if (!p) throw new Error("Listing not found");
  if (p.status !== "Available" || new Date(p.expires_at) < new Date()) throw new Error("This listing is no longer available");
  if (!p.price || Number(p.price) <= 0) throw new Error("This listing has no price");
  const sellerEmail = String(p.seller_email ?? "").toLowerCase();
  if (sellerEmail === buyerEmail) throw new Error("You can't buy your own listing");
  const { data: s } = await db.from("seller_profiles").select("*").eq("seller_email", sellerEmail).maybeSingle();
  if (!s) throw new Error("This seller hasn't set up payouts yet, so it can't be bought online");
  return { p, s };
}
