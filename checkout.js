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
    const isCollect = () => box.querySelector('input[name="method"]:checked')?.value === "collect";

    const methodBox = el("div", { style: "margin:4px 0 12px;font-size:14px" },
      el("label", { style: "display:block;margin:4px 0" },
        el("input", { type: "radio", name: "method", value: "courier", checked: true, onchange: sync }), " Courier delivery"),
      el("label", { style: "display:block;margin:4px 0" },
        el("input", { type: "radio", name: "method", value: "collect", onchange: sync }), " Collect from the seller (free)"));
    const addrBox = el("div", {}, ...addrFields(), btn("Get delivery options", getRates));
    const out = el("div");

    box.append(field("Full name", "name"), field("Cell number", "phone", { type: "tel", max: 15 }),
      methodBox, addrBox, out, msg(box));

    function sync() {
      msg(box).textContent = "";
      out.replaceChildren();
      addrBox.style.display = isCollect() ? "none" : "";
      if (isCollect()) {
        out.append(
          el("p", { textContent: `Item ${rand(Math.round(Number(product.price) * 100))}. No delivery fee. After paying you'll get the seller's contact details to arrange collection.`, style: "font-size:13px;color:#555" }),
          btn("Pay with PayFast", pay));
      }
    }

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
      const collect = isCollect();
      const code = collect ? "COLLECT" : box.querySelector('input[name="rate"]:checked')?.value;
      msg(box).textContent = "Preparing secure payment...";
      try {
        const r = await call("create-payment", {
          product_id: product.id, address: collect ? {} : addr(box), service_level_code: code,
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
    const BANKS = ["Capitec", "FNB", "Standard Bank", "Absa", "Nedbank", "TymeBank", "Discovery Bank", "African Bank", "Other"];
    const { box, close } = modal("Get paid & courier pickup");
    box.append(
      el("p", { textContent: "Buyers pay TechCompare OS. After the buyer confirms they received the item (or 7 days after payment), we pay the sale price minus our fee to your bank account by EFT. The courier collects from the address below.", style: "font-size:13px" }),
      field("Full name", "full_name"), field("Cell number", "phone", { type: "tel", max: 15 }),
      field("Bank", "bank_name", { options: BANKS }), field("Account holder name", "account_holder"),
      field("Account number", "account_number", { type: "tel", max: 16 }),
      field("Account type", "account_type", { options: ["Savings", "Cheque"] }),
      field("Branch code (6 digits, your bank's universal code)", "branch_code", { type: "tel", max: 6 }),
      ...addrFields(), btn("Save", save), msg(box)
    );

    // Fill in what the seller saved before
    const { data: old } = await sb.from("seller_profiles").select("*").eq("seller_email", email).maybeSingle();
    if (old) {
      ["full_name", "phone", "bank_name", "account_holder", "account_number", "account_type", "branch_code",
       "street_address", "local_area", "city", "province", "postal_code"].forEach((k) => {
        const f = box.querySelector(`[name="${k}"]`);
        if (f && old[k]) f.value = old[k];
      });
    }

    async function save() {
      const row = {
        seller_email: email, full_name: val(box, "full_name"),
        phone: val(box, "phone").replace(/[^\d+]/g, ""),
        bank_name: val(box, "bank_name"), account_holder: val(box, "account_holder"),
        account_number: val(box, "account_number").replace(/\s/g, ""),
        account_type: val(box, "account_type"), branch_code: val(box, "branch_code").replace(/\s/g, ""),
        ...addr(box), updated_at: new Date().toISOString(),
      };
      if (!/^\d{6,16}$/.test(row.account_number)) { msg(box).textContent = "Account number must be 6 to 16 digits."; return; }
      if (!/^\d{6}$/.test(row.branch_code)) { msg(box).textContent = "Branch code must be 6 digits."; return; }
      if (row.account_holder.length < 2) { msg(box).textContent = "Enter the account holder's name."; return; }
      const { error } = await sb.from("seller_profiles").upsert(row);
      if (error) { msg(box).style.color = "#b00020"; msg(box).textContent = "Check your details: " + error.message; }
      else { msg(box).style.color = "#0a7d2c"; msg(box).textContent = "Saved. Buyers can now pay you online."; setTimeout(close, 1200); }
    }
  }

  const note = (box, text, bold) => box.append(el("p", { textContent: text, style: bold ? "font-weight:600" : "font-size:14px" }));

  async function showContact(box, orderId) {
    try {
      const c = await call("order-contact", { order_id: orderId });
      note(box, "Collect from: " + c.name, true);
      note(box, "Cell: " + c.phone);
      note(box, "Pickup area: " + c.pickup);
      note(box, "Agree a time with the seller by phone, or use Messages (" + c.email.split("@")[0] + ").");
    } catch (e) { note(box, e.message); }
  }

  async function handleReturn() {
    const q = new URLSearchParams(location.search);
    const state = q.get("payment");
    if (!state) return;
    history.replaceState(null, "", location.pathname);
    const { box } = modal(state === "success" ? "Thanks, payment received" : "Payment cancelled");
    if (state !== "success") {
      note(box, "No money was taken. You can try again from the listing.");
      return;
    }
    note(box, "We're confirming your payment...");
    const id = q.get("order");
    if (!id) return;
    for (let i = 0; i < 8; i++) {
      const { data } = await sb.from("orders").select("status,service_level_code,tracking_reference").eq("id", id).maybeSingle();
      if (data?.status === "paid") {
        if (data.service_level_code === "COLLECT") { await showContact(box, id); }
        else if (data.tracking_reference) { note(box, "Tracking reference: " + data.tracking_reference, true); }
        else { note(box, "Payment confirmed. Your courier is being arranged, and you'll find it under My Orders."); }
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    note(box, "Your payment is still being confirmed. Check My Orders in a minute.");
  }

  async function myOrders() {
    const { data: u } = await sb.auth.getUser();
    const me = u?.user?.email?.toLowerCase();
    if (!me) return alert("Please sign in first");
    const { box } = modal("My orders");
    const { data, error } = await sb.from("orders").select("*").eq("status", "paid").order("created_at", { ascending: false }).limit(50);
    if (error) { note(box, "Could not load your orders."); return; }
    if (!data?.length) { note(box, "No paid orders yet."); return; }
    data.forEach((o) => {
      const sold = o.seller_email.toLowerCase() === me;
      const collect = o.service_level_code === "COLLECT";
      const card = el("div", { style: "border:1px solid #ccd;border-radius:8px;padding:10px;margin-bottom:10px;font-size:14px" });
      card.append(el("strong", { textContent: (sold ? "SOLD: " : "BOUGHT: ") + (o.product_title || "Item") }));
      const line = (t) => card.append(el("div", { textContent: t }));
      line(sold ? `You receive ${rand(o.item_cents - o.fee_cents)}` : `You paid ${rand(o.total_cents)}`);
      line(new Date(o.paid_at || o.created_at).toLocaleDateString());
      if (sold) {
        line(`Buyer: ${o.buyer_name}, ${o.buyer_phone}`);
        line(collect ? "Collection: arrange a time with the buyer." : (o.tracking_reference ? "Courier tracking: " + o.tracking_reference : "Pack the item. The courier will collect from your saved pickup address."));
        line(o.payout_status === "paid" ? "Payout: paid to your bank account." : o.payout_status === "ready"
          ? "Payout: approved, we will transfer it soon." : "Payout: held until the buyer confirms receipt, or 7 days after payment.");
      } else if (collect) {
        card.append(el("button", { textContent: "Show seller contact", style: "margin-top:6px;padding:6px 10px;cursor:pointer", onclick: (ev) => { ev.target.remove(); showContact(card, o.id); } }));
      } else {
        line(o.tracking_reference ? "Tracking: " + o.tracking_reference : "Courier is being arranged.");
      }
      if (!sold && o.payout_status === "held") {
        card.append(el("button", { textContent: "✅ I received my item", style: "margin-top:8px;padding:6px 10px;cursor:pointer;display:block",
          onclick: async (ev) => {
            const b = ev.target;
            if (!confirm("Only confirm if you have the item and it is as described. This releases the seller's payment.")) return;
            b.disabled = true;
            try { await call("confirm-received", { order_id: o.id }); b.replaceWith(el("div", { textContent: "Thanks, receipt confirmed.", style: "margin-top:8px" })); }
            catch (e) { b.disabled = false; alert(e.message); }
          } }));
      }
      box.append(card);
    });
  }

  return { myOrders, init: (client, apiBase) => { sb = client; api = String(apiBase || '').replace(/\/$/, ''); }, buy, sellerSetup, handleReturn };
})();
