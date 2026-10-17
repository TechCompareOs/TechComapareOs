/* TechCompare OS checkout. Add to index.html AFTER app.js:  <script src="checkout.js"></script>
 *
 *   TechCheckout.init(supabaseClient, PAYMENTS_API);   // once: Supabase client + your Python API URL
 *   TechCheckout.buy(product);                  // from a "Buy now" button; product = a row from public.products
 *   TechCheckout.sellerSetup();                 // from a "Get paid" button for sellers
 *   TechCheckout.handleReturn();                // once on page load (shows result after PayFast redirect)
 */
const TechCheckout = (() => {
  let sb;
  let api = '';
  const PROVINCES = ["Eastern Cape","Free State","Gauteng","KwaZulu-Natal","Limpopo","Mpumalanga","Northern Cape","North West","Western Cape"];
  const rand = (c) => "R" + (c / 100).toFixed(2);

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n[k] = v;
    }
    kids.flat().forEach((c) => n.append(c));
    return n;
  };

  function modal(title) {
    const box = el("div", { style: "background:#fff;color:#111;max-width:440px;width:92%;max-height:90vh;overflow:auto;border-radius:12px;padding:20px;font-family:inherit" });
    const back = el("div", { style: "position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999" }, box);
    back.addEventListener("click", (e) => { if (e.target === back) back.remove(); });
    box.append(el("h3", { textContent: title, style: "margin:0 0 12px" }));
    document.body.append(back);
    return { box, close: () => back.remove() };
  }

  const field = (label, name, opts = {}) => {
    const input = opts.options
      ? el("select", { name, style: "width:100%;padding:8px;margin:2px 0 10px" }, opts.options.map((o) => el("option", { value: o, textContent: o })))
      : el("input", { name, type: opts.type || "text", placeholder: opts.ph || "", maxLength: opts.max || 100, style: "width:100%;padding:8px;margin:2px 0 10px;box-sizing:border-box" });
    return el("label", { style: "display:block;font-size:13px" }, label, input);
  };

  const val = (box, name) => box.querySelector(`[name="${name}"]`).value.trim();
  const msg = (box) => box.querySelector(".tc-msg") || box.appendChild(el("p", { className: "tc-msg", style: "color:#b00020;font-size:13px;min-height:18px" }));
  const btn = (text, fn, dark = true) => el("button", { textContent: text, onclick: fn, style: `width:100%;padding:10px;border:0;border-radius:8px;cursor:pointer;font-weight:600;background:${dark ? "#111;color:#fff" : "#eee;color:#111"}` });

  const addr = (box) => ({
    street_address: val(box, "street_address"), local_area: val(box, "local_area"),
    city: val(box, "city"), province: val(box, "province"), postal_code: val(box, "postal_code"),
  });
  const addrFields = () => [
    field("Street address", "street_address"), field("Suburb", "local_area"),
    field("City / town", "city"), field("Province", "province", { options: PROVINCES }),
    field("Postal code", "postal_code", { max: 4, ph: "0000" }),
  ];

  async function call(path, body) {
    const { data: s } = await sb.auth.getSession();
    const token = s?.session?.access_token;
    if (!token) throw new Error("Please sign in first");
    let res;
    try {
      res = await fetch(api + "/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(body),
      });
    } catch (_) {
      throw new Error("The payment server is waking up. Please try again in a minute.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
  }

  function buy(product) {
    const { box } = modal("Checkout: " + (product.title || product.name || "Item"));
    box.append(
      field("Full name", "name"), field("Cell number", "phone", { type: "tel", max: 15 }),
      ...addrFields(), btn("Get delivery options", getRates), msg(box)
    );
    const out = el("div"); box.append(out);

    async function getRates() {
      msg(box).textContent = "Fetching Courier Guy rates...";
      out.replaceChildren();
      try {
        const r = await call("courier-rates", { product_id: product.id, address: addr(box) });
        msg(box).textContent = "";
        r.rates.forEach((rt, i) => out.append(el("label", { style: "display:block;margin:6px 0;font-size:14px" },
          el("input", { type: "radio", name: "rate", value: rt.code, checked: i === 0 }),
          ` ${rt.name}: ${rand(rt.cents)}`)));
        out.append(el("p", { textContent: `Item ${rand(r.item_cents)} + delivery. Total shown on PayFast.`, style: "font-size:12px;color:#555" }),
          btn("Pay with PayFast", pay));
      } catch (e) { msg(box).textContent = e.message; }
    }

    async function pay() {
      const code = box.querySelector('input[name="rate"]:checked')?.value;
      msg(box).textContent = "Preparing secure payment...";
      try {
        const r = await call("create-payment", {
          product_id: product.id, address: addr(box), service_level_code: code,
          name: val(box, "name"), phone: val(box, "phone"),
        });
        const form = el("form", { method: "POST", action: r.action });
        r.fields.forEach(([k, v]) => form.append(el("input", { type: "hidden", name: k, value: v })));
        document.body.append(form);
        form.submit();
      } catch (e) { msg(box).textContent = e.message; }
    }
  }

  async function sellerSetup() {
    const { data: u } = await sb.auth.getUser();
    const email = u?.user?.email?.toLowerCase();
    if (!email) return alert("Please sign in first");
    const { box, close } = modal("Get paid & courier pickup");
    box.append(
      el("p", { textContent: "Buyers pay through PayFast and you receive your share directly into your PayFast account. The Courier Guy collects from the address below.", style: "font-size:13px" }),
      field("Full name", "full_name"), field("Cell number", "phone", { type: "tel", max: 15 }),
      field("PayFast merchant ID", "payfast_merchant_id", { max: 12 }),
      ...addrFields(), btn("Save", save), msg(box)
    );
    async function save() {
      const row = {
        seller_email: email, full_name: val(box, "full_name"),
        phone: val(box, "phone").replace(/[^\d+]/g, ""),
        payfast_merchant_id: val(box, "payfast_merchant_id"), ...addr(box),
        updated_at: new Date().toISOString(),
      };
      const { error } = await sb.from("seller_profiles").upsert(row);
      if (error) msg(box).textContent = "Check your details: " + error.message;
      else { msg(box).style.color = "#0a7d2c"; msg(box).textContent = "Saved. Buyers can now pay you online."; setTimeout(close, 1200); }
    }
  }

  async function handleReturn() {
    const q = new URLSearchParams(location.search);
    const state = q.get("payment");
    if (!state) return;
    history.replaceState(null, "", location.pathname);
    const { box } = modal(state === "success" ? "Thanks, payment received" : "Payment cancelled");
    box.append(el("p", { textContent: state === "success"
      ? "We're confirming your payment and booking The Courier Guy. Your tracking reference will appear in your orders shortly."
      : "No money was taken. You can try again from the listing." }));
    if (state === "success" && q.get("order")) {
      for (let i = 0; i < 6; i++) {
        const { data } = await sb.from("orders").select("status,tracking_reference").eq("id", q.get("order")).maybeSingle();
        if (data?.tracking_reference) { box.append(el("p", { textContent: "Tracking reference: " + data.tracking_reference, style: "font-weight:600" })); break; }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  return { init: (client, apiBase) => { sb = client; api = String(apiBase || '').replace(/\/$/, ''); }, buy, sellerSetup, handleReturn };
})();
