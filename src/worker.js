// Pollfinity opt-in pipeline worker
// Routes:
//   POST /api/optin           form submissions -> D1 + Web3Forms email notification
//   GET  /api/optin/count     public count of confirmed+pending panelists (for the counter widget)
//   GET  /api/optin/export    CSV export for Prompt.io / ESP import (requires ?key=ADMIN_KEY)
// Everything else falls through to static assets.

const WEB3FORMS_KEY = "e2ce76da-3f09-4618-8fa2-40b3ca27e447";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/optin" && request.method === "POST") {
      return handleOptin(request, env);
    }
    if (url.pathname === "/api/optin/count" && request.method === "GET") {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM optins WHERE status != 'revoked'"
      ).first();
      return json({ count: row.n });
    }
    if (url.pathname === "/api/optin/export" && request.method === "GET") {
      if (url.searchParams.get("key") !== env.ADMIN_KEY) {
        return new Response("forbidden", { status: 403 });
      }
      return exportCsv(env, url.searchParams.get("status"));
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleOptin(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ success: false, message: "bad request" }, 400);
  }

  // Honeypot: real users never fill this hidden field
  if ((form.get("botcheck") || "").trim() !== "") {
    return json({ success: true }); // silently drop bots
  }

  const rec = {
    first_name: clean(form.get("first_name"), 60),
    last_name: clean(form.get("last_name"), 60),
    phone: normalizePhone(form.get("phone")),
    email: clean(form.get("email"), 120).toLowerCase(),
    zip: clean(form.get("zip"), 5),
    state: clean(form.get("state"), 2),
    party: clean(form.get("party"), 30),
    age_range: clean(form.get("age_range"), 20),
    consent_sms: form.get("sms_consent") === "yes" ? 1 : 0,
    utm_source: clean(form.get("utm_source"), 60),
    utm_medium: clean(form.get("utm_medium"), 60),
    utm_campaign: clean(form.get("utm_campaign"), 80),
    utm_content: clean(form.get("utm_content"), 80),
    referrer: clean(form.get("page_referrer"), 200),
  };

  if (!rec.first_name || !rec.zip || !rec.state) {
    return json({ success: false, message: "missing required fields" }, 422);
  }
  // Panel rule: need at least one reachable channel
  if (!rec.phone && !rec.email) {
    return json(
      { success: false, message: "provide a mobile number or an email" },
      422
    );
  }
  // SMS consent requires a phone number
  if (rec.consent_sms && !rec.phone) {
    return json(
      { success: false, message: "SMS consent requires a mobile number" },
      422
    );
  }

  // Capture the exact consent text shown at submit time (audit trail for TCPA)
  const consentText = rec.consent_sms
    ? clean(form.get("consent_text_snapshot"), 1200)
    : "";

  try {
    await env.DB.prepare(
      `INSERT INTO optins
        (first_name,last_name,phone,email,zip,state,party,age_range,
         consent_sms,consent_text,utm_source,utm_medium,utm_campaign,utm_content,referrer)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(phone) DO UPDATE SET
         email=excluded.email, zip=excluded.zip, state=excluded.state,
         party=excluded.party, age_range=excluded.age_range,
         consent_sms=excluded.consent_sms, consent_text=excluded.consent_text,
         updated_at=datetime('now')`
    )
      .bind(
        rec.first_name, rec.last_name, rec.phone || null, rec.email || null,
        rec.zip, rec.state, rec.party, rec.age_range,
        rec.consent_sms, consentText,
        rec.utm_source, rec.utm_medium, rec.utm_campaign, rec.utm_content,
        rec.referrer
      )
      .run();
  } catch (e) {
    // Unique-email collision lands here; treat as an update-by-email
    try {
      await env.DB.prepare(
        `UPDATE optins SET phone=COALESCE(?,phone), zip=?, state=?, party=?,
           age_range=?, consent_sms=?, updated_at=datetime('now')
         WHERE email=?`
      )
        .bind(rec.phone || null, rec.zip, rec.state, rec.party,
              rec.age_range, rec.consent_sms, rec.email)
        .run();
    } catch {
      return json({ success: false, message: "storage error" }, 500);
    }
  }

  // Keep the existing email notification flowing (non-blocking)
  const notify = new FormData();
  notify.set("access_key", WEB3FORMS_KEY);
  notify.set("subject", "New Pollfinity Panel Opt-In");
  notify.set("from_name", "Pollfinity Research");
  for (const [k, v] of Object.entries(rec)) notify.set(k, String(v ?? ""));
  const notifyPromise = fetch("https://api.web3forms.com/submit", {
    method: "POST",
    body: notify,
    headers: { Accept: "application/json" },
  }).catch(() => {});
  if (typeof globalThis.waitUntil === "function") waitUntil(notifyPromise);

  return json({ success: true });
}

async function exportCsv(env, statusFilter) {
  const where = statusFilter ? "WHERE status = ?" : "";
  const stmt = env.DB.prepare(
    `SELECT first_name,last_name,phone,email,zip,state,party,age_range,
            consent_sms,status,utm_source,utm_campaign,created_at
     FROM optins ${where} ORDER BY created_at`
  );
  const { results } = statusFilter ? await stmt.bind(statusFilter).all() : await stmt.all();
  const cols = [
    "first_name","last_name","phone","email","zip","state","party","age_range",
    "consent_sms","status","utm_source","utm_campaign","created_at",
  ];
  const lines = [cols.join(",")];
  for (const r of results) {
    lines.push(cols.map((c) => csvCell(r[c])).join(","));
  }
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=pollfinity-panel.csv",
    },
  });
}

function clean(v, max) {
  return String(v ?? "").trim().slice(0, max);
}

function normalizePhone(v) {
  const digits = String(v ?? "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return ""; // invalid or empty -> treated as no phone
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
