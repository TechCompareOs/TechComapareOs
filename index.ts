import { admin, cleanAddress, cors, getUser, isTut, json, loadListing, quote } from "../_shared/lib.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await getUser(req);
    if (!user?.email) return json({ error: "Please sign in first" }, 401);
    const email = user.email.toLowerCase();
    if (!isTut(email)) return json({ error: "Only verified TUT students can buy" }, 403);

    const { product_id, address } = await req.json();
    const delivery = cleanAddress(address);
    const { p, s } = await loadListing(admin(), String(product_id), email);

    const rates = await quote(s, delivery, p);
    if (!rates.length) return json({ error: "No courier options for that address" }, 422);

    return json({
      item_cents: Math.round(Number(p.price) * 100),
      rates: rates.map((r: any) => ({ ...r, cents: Math.round(r.amount * 100) })),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
