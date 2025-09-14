// functions/api.ts
type Env = {
  DB: D1Database;
  API_KEY?: string; API?: string; API_TOKEN?: string;
  ADMIN_TOKEN?: string; ADMIN_KEY?: string;
};

const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

const getApiKey   = (env: Env) => env.API_KEY || (env as any).API || env.API_TOKEN || "";
const getAdminKey = (env: Env) => env.ADMIN_TOKEN || env.ADMIN_KEY || "";

async function ensureSchema(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, channel TEXT, note TEXT, created_at INTEGER NOT NULL)").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email ON leads (tenant, email)").run();
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";
  const method = request.method.toUpperCase();
  const auth = request.headers.get("authorization") || "";

  const apiKey   = getApiKey(env);
  const adminKey = getAdminKey(env);

  const isApi   = !!apiKey   && auth === `Bearer ${apiKey}`;
  const isAdmin = !!adminKey && auth === `Bearer ${adminKey}`;

  // Admin は API の上位互換として扱う
  const hasApi = isApi || isAdmin;

  let body: any = null;
  if (["POST","PUT","PATCH"].includes(method)) body = await request.json().catch(() => null);

  switch (action) {
    case "__actions__":
      return json({ ok:true, actions:["__echo__","lead.add","lead.list","admin.d1.tables","admin.d1.migrate"] });

    case "__echo__":
      if (!hasApi) return json({ ok:false, error:"unauthorized", need:"api" }, 401);
      return json({ ok:true, action, payload: body ?? null });

    case "lead.add": {
      if (!hasApi) return json({ ok:false, error:"unauthorized", need:"api" }, 401);
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

      return json({ ok:true });
    }

    case "lead.list": {
      if (!hasApi) return json({ ok:false, error:"unauthorized", need:"api" }, 401);
      const tenant = String(body?.tenant || url.searchParams.get("tenant") || "salon-booking-saas").trim();
      const limit  = Math.max(1, Math.min(200, Number(body?.limit ?? 100)));
      const { results } = await env.DB.prepare(
        "SELECT id, tenant, name, email, channel, note, created_at FROM leads WHERE tenant = ? ORDER BY created_at DESC LIMIT ?"
      ).bind(tenant, limit).all();
      return json({ ok:true, items: results || [] });
    }

    case "admin.d1.tables": {
      if (!isAdmin) return json({ ok:false, error:"unauthorized", need:"admin" }, 401);
      const tables  = await env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
      const indexes = await env.DB.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index'").all();
      return json({ ok:true, tables: tables?.results || [], indexes: indexes?.results || [] });
    }

    case "admin.d1.migrate": {
      if (!isAdmin) return json({ ok:false, error:"unauthorized", need:"admin" }, 401);
      await ensureSchema(env.DB);
      return json({ ok:true, version: String(body?.version || "v1") });
    }

    default:
      return json({ ok:false, error:"unknown_action", action });
  }
};
