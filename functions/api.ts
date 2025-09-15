interface Env {
  DB: D1Database;
  API_KEY?: string; API?: string; API_TOKEN?: string;
  ADMIN_TOKEN?: string; ADMIN_KEY?: string; ADMIN?: string;
}

type J = Record<string, unknown>;

function json(obj: J, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function readToken(req: Request): string | null {
  const h = req.headers;
  const auth = h.get("authorization") || h.get("Authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return h.get("x-api-key") || h.get("X-API-KEY");
}

function getApiSecret(env: Env): string | null {
  return env.API_KEY || env.API || env.API_TOKEN || null;
}
function getAdminSecret(env: Env): string | null {
  return env.ADMIN_TOKEN || env.ADMIN_KEY || env.ADMIN || null;
}

function newId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const action = (url.searchParams.get("action") || "").trim();

  // 公開で見せるアクション一覧
  if (request.method === "GET" && action === "__actions__") {
    return json({
      ok: true,
      actions: ["__actions__", "__echo__", "lead.add", "lead.list", "admin.d1.tables", "admin.d1.migrate"],
    });
  }

  // 共通ヘルパ
  const token = readToken(request);
  const apiSecret = getApiSecret(env);
  const adminSecret = getAdminSecret(env);

  async function requireAPI() {
    if (!token || !apiSecret || token !== apiSecret) throw json({ ok: false, error: "unauthorized", need: "api" }, 401);
  }
  async function requireADMIN() {
    if (!token || !adminSecret || token !== adminSecret) throw json({ ok: false, error: "unauthorized", need: "admin" }, 401);
  }

  try {
    switch (action) {
      // ===== echo（API必須）=====
      case "__echo__": {
        await requireAPI();
        let raw: any = null;
        try { raw = await request.json(); } catch {}
        return json({ ok: true, action, raw, method: request.method });
      }

      // ===== リード追加（API）=====
      case "lead.add": {
        await requireAPI();
        if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
        let b: any; try { b = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
        const tenant = String(b?.tenant || "").trim();
        const name   = String(b?.name   || "").trim();
        const email  = String(b?.email  || "").trim().toLowerCase();
        const channel= String(b?.channel|| "").trim() || null;
        const note   = String(b?.note   || "").trim() || null;
        if (!tenant || !name || !email) return json({ ok: false, error: "missing_params" }, 400);

        const now = Math.floor(Date.now() / 1000);
        const id  = newId();
        await env.DB.prepare(
          `INSERT INTO leads (id, tenant, name, email, channel, note, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(tenant, email) DO UPDATE SET
             name=excluded.name,
             channel=excluded.channel,
             note=excluded.note,
             created_at=excluded.created_at`
        ).bind(id, tenant, name, email, channel, note, now).run();

        const row = await env.DB.prepare(
          `SELECT id FROM leads WHERE tenant=?1 AND email=?2`
        ).bind(tenant, email).first<{ id: string }>();

        return json({ ok: true, id: row?.id || id });
      }

      // ===== リード一覧（API）=====
      case "lead.list": {
        await requireAPI();
        if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
        let b: any; try { b = await request.json(); } catch { b = {}; }
        const tenant = String(b?.tenant || "").trim();
        const q = tenant
          ? `SELECT id, tenant, name, email, channel, note, created_at
               FROM leads WHERE tenant=?1 ORDER BY created_at DESC`
          : `SELECT id, tenant, name, email, channel, note, created_at
               FROM leads ORDER BY created_at DESC`;
        const { results } = tenant
          ? await env.DB.prepare(q).bind(tenant).all()
          : await env.DB.prepare(q).all();
        return json({ ok: true, items: results || [] });
      }

      // ===== D1 テーブル一覧（ADMIN）=====
      case "admin.d1.tables": {
        await requireADMIN();
        const tables = await env.DB.prepare(
          `SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name ASC`
        ).all();

        const indexes = await env.DB.prepare(
          `SELECT name, tbl_name, sql FROM sqlite_schema WHERE type='index' ORDER BY name ASC`
        ).all();

        return json({ ok: true, tables: tables.results || [], indexes: indexes.results || [] });
      }

      // ===== マイグレーション（ADMIN）– 安定版（1ステートメントずつ）=====
      case "admin.d1.migrate": {
        await requireADMIN();

        const have = await env.DB.prepare(
          `SELECT name FROM sqlite_schema WHERE type='table' AND name='leads'`
        ).all();

        if ((have.results?.length || 0) > 0) {
          await env.DB.exec(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email
              ON leads (tenant, email);
          `);
          return json({ ok: true, migrated: false, note: "schema already present" });
        }

        await env.DB.exec(`
          CREATE TABLE IF NOT EXISTS leads (
            id TEXT PRIMARY KEY,
            tenant TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            channel TEXT,
            note TEXT,
            created_at INTEGER NOT NULL
          );
        `);
        await env.DB.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email
            ON leads (tenant, email);
        `);

        return json({ ok: true, migrated: true });
      }

      default:
        return json({ ok: false, error: "unknown_action", action }, 400);
    }
  } catch (e: any) {
    if (e instanceof Response) return e; // requireAPI/ADMIN の throw をそのまま返す
    const msg = String(e?.message || e);
    return json({ ok: false, error: "exception", detail: msg }, 500);
  }
};
