// functions/api.ts
// Query ?action=... のAPIゲートウェイ。API/ADMINトークン検証付き。
// 既存の /add-lead, /diag-leads は残してOK（将来は統合で可）。

type Env = {
  DB: D1Database;
  API_KEY?: string;      // 例: 1785ad77...
  ADMIN_TOKEN?: string;  // 例: f70bb796...
};

const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

const need = (who: "api" | "admin") => json({ ok: false, error: "unauthorized", need: who }, 401);

async function ensureSchema(db: D1Database) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, channel TEXT, note TEXT, created_at INTEGER NOT NULL)"
  ).run();
  await db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email ON leads (tenant, email)"
  ).run();
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";
  const method = request.method.toUpperCase();
  const auth = request.headers.get("authorization") || "";

  const isApi   = !!env.API_KEY     && auth === `Bearer ${env.API_KEY}`;
  const isAdmin = !!env.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`;

  let body: any = null;
  if (["POST","PUT","PATCH"].includes(method)) {
    body = await request.json().catch(() => null);
  }

  switch (action) {
    case "__actions__":
      return json({ ok: true, actions: ["__echo__","lead.add","lead.list","admin.d1.tables","admin.d1.migrate"] });

    case "__echo__":
      if (!isApi && !isAdmin) return need("api");
      return json({ ok: true, action, payload: body ?? null, tenant: body?.tenant ?? url.searchParams.get("tenant") ?? null });

    case "lead.add": {
      if (!isApi) return need("api");
      if (!env.DB) return json({ ok:false, error:"d1_binding_missing" }, 500);
      await ensureSchema(env.DB);

      const tenant  = String(body?.tenant || url.searchParams.get("tenant") || "salon-booking-saas").trim();
      const name    = String(body?.name   || "").trim();
      const email   = String(body?.email  || "").trim().toLowerCase();
      const channel = String(body?.channel|| "Email").trim();
      const note    = String(body?.note   || "").trim();
      if (!tenant || !name || !email) return json({ ok:false, error:"bad_request_missing_fields" }, 400);

      await env.DB.prepare(
        "INSERT INTO leads (id, tenant, name, email, channel, note, created_at) VALUES (hex(randomblob(16)), ?, ?, ?, ?, ?, unixepoch()) ON CONFLICT(tenant, email) DO UPDATE SET name=excluded.name, channel=excluded.channel, note=excluded.note, created_at=unixepoch()"
      ).bind(tenant, name, email, channel, note).run();

      return json({ ok: true });
    }

    case "lead.list": {
      if (!isApi && !isAdmin) return need("api");
      if (!env.DB) return json({ ok:false, error:"d1_binding_missing" }, 500);

      const tenant = String(body?.tenant || url.searchParams.get("tenant") || "salon-booking-saas").trim();
      const limit  = Math.max(1, Math.min(200, Number(body?.limit ?? 100)));

      const { results } = await env.DB.prepare(
        "SELECT id, tenant, name, email, channel, note, created_at FROM leads WHERE tenant = ? ORDER BY created_at DESC LIMIT ?"
      ).bind(tenant, limit).all();

      return json({ ok: true, items: results || [] });
    }

    case "admin.d1.tables": {
      if (!isAdmin) return need("admin");
      const tables  = await env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
      const indexes = await env.DB.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index'").all();
      return json({ ok: true, tables: tables?.results || [], indexes: indexes?.results || [] });
    }

    case "admin.d1.migrate": {
      if (!isAdmin) return need("admin");
      await ensureSchema(env.DB);
      return json({ ok: true, version: String(body?.version || "v1") });
    }

    default:
      return json({ ok: false, error: "unknown_action", action });
  }
};
