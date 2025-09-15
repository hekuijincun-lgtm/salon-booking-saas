// functions/api.js
// Query:  /api?action=xxx
// Actions: __actions__, __echo__, lead.add, lead.list, admin.d1.tables, admin.d1.migrate
// Auth: API側=API_KEY, Admin側=ADMIN_TOKEN (互換: ADMIN_KEY)

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";

  // === helpers ===
  const json = (obj, status = 200, headers = {}) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", ...headers },
    });

  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const xApi   = (request.headers.get("x-api-key") || "").trim();

  const isApiKey = (t) => !!t && (t === env.API_KEY);
  const isAdmin  = (t) => !!t && (t === env.ADMIN_TOKEN || (env.ADMIN_KEY && t === env.ADMIN_KEY));

  const okAPI   = isApiKey(bearer) || isApiKey(xApi);
  const okADMIN = isAdmin(bearer);

  async function requireAPI() {
    if (!okAPI) throw json({ ok: false, error: "unauthorized", need: "api" }, 401);
  }
  async function requireADMIN() {
    if (!okADMIN) throw json({ ok: false, error: "unauthorized", need: "admin" }, 401);
  }

  // D1 helpers
  const nowSec = () => Math.floor(Date.now() / 1000);
  const newId  = () =>
    [...crypto.getRandomValues(new Uint8Array(16))]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();

  async function tableExists(name) {
    const r = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).bind(name).first();
    return r?.name === name;
  }

  // === router ===
  try {
    switch (action) {
      case "__actions__":
        return json({
          ok: true,
          actions: ["__actions__", "__echo__", "lead.add", "lead.list", "admin.d1.tables", "admin.d1.migrate"],
        });

      case "__echo__": {
        await requireAPI(); // APIキーで守る（必要に応じて緩めてもOK）
        let raw = null;
        try { raw = await request.json(); } catch {}
        return json({ ok: true, action: "__echo__", raw, method: request.method });
      }

      case "lead.add": {
        await requireAPI();
        if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

        let body = {};
        try { body = await request.json(); } catch {}
        const tenant  = (body.tenant  || "").trim();
        const name    = (body.name    || "").trim();
        const email   = (body.email   || "").trim().toLowerCase();
        const channel = (body.channel || "").trim() || null;
        const note    = (body.note    || "").trim() || null;

        if (!tenant || !name || !email) {
          return json({ ok: false, error: "invalid_params", need: ["tenant","name","email"] }, 400);
        }

        const id = newId();
        const created = nowSec();

        // 一意制約 (tenant,email) に対して UPSERT（既存は上書き）
        await env.DB.prepare(
          `INSERT INTO leads (id, tenant, name, email, channel, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant, email) DO UPDATE SET
             name=excluded.name, channel=excluded.channel, note=excluded.note`
        ).bind(id, tenant, name, email, channel, note, created).run();

        return json({ ok: true, id });
      }

      case "lead.list": {
        await requireAPI();
        if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

        let body = {};
        try { body = await request.json(); } catch {}
        const tenant = (body.tenant || "").trim();
        if (!tenant) return json({ ok: false, error: "invalid_params", need: ["tenant"] }, 400);

        const { results } = await env.DB.prepare(
          `SELECT id, tenant, name, email, channel, note, created_at
             FROM leads
            WHERE tenant=?
            ORDER BY created_at DESC`
        ).bind(tenant).all();

        return json({ ok: true, items: results || [] });
      }

      case "admin.d1.tables": {
        await requireADMIN();
        // 一覧（テーブルとインデックス）。POST/GETどちらでもOKにする
        const tables = (await env.DB.prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"
        ).all()).results || [];

        const indexes = (await env.DB.prepare(
          "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' ORDER BY name"
        ).all()).results || [];

        return json({ ok: true, tables, indexes });
      }

      case "admin.d1.migrate": {
        await requireADMIN();
        // 冪等: 既存ならOK返す。versionは将来拡張用
        let version = "v3";
        try {
          const body = await request.json();
          if (body?.version) version = String(body.version);
        } catch {}

        if (version !== "v3") return json({ ok: false, error: "unknown_version", version }, 400);

        // 正しい完全SQLを個別に投入（過去の「空の CREATE TABLE (」を撲滅）
        try {
          await env.DB.batch([
            env.DB.prepare(`CREATE TABLE IF NOT EXISTS leads (
              id         TEXT PRIMARY KEY,
              tenant     TEXT NOT NULL,
              name       TEXT NOT NULL,
              email      TEXT NOT NULL,
              channel    TEXT,
              note       TEXT,
              created_at INTEGER NOT NULL
            )`),
            env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email
                              ON leads (tenant, email)`)
          ]);
          return json({ ok: true, version, changed: true });
        } catch (e) {
          // 既に存在していれば OK 扱い
          if (await tableExists("leads")) {
            return json({ ok: true, version, changed: false, already: true });
          }
          return json({ ok: false, error: "exception", detail: String(e) }, 500);
        }
      }

      default:
        return json({ ok: false, error: "unknown_action", action }, 404);
    }
  } catch (res) {
    // 上の requireAPI/ADMIN が投げた JSON Response を素通し
    if (res instanceof Response) return res;
    return json({ ok: false, error: "exception", detail: String(res) }, 500);
  }
}
