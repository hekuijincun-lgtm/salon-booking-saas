// /functions/api.ts
export interface Env {
  DB: D1Database;
  API_KEY?: string;   // 推奨：これを使う
  API?: string;
  API_TOKEN?: string;
  ADMIN_TOKEN?: string; // 管理系はこっち
  ADMIN_KEY?: string;
}

type Json = Record<string, unknown> | unknown[];

const ACTIONS = [
  "__actions__",
  "__echo__",
  "lead.add",
  "lead.list",
  "admin.d1.tables",
  "admin.d1.migrate",
];

// 公開してよいアクション（不要なら空に）
const PUBLIC = new Set<string>(["__actions__"]);

// ===== Helpers =====
const cors = (req: Request) => ({
  "access-control-allow-origin": req.headers.get("origin") || "*",
  "access-control-allow-headers": "authorization,content-type,x-api-key",
  "access-control-allow-methods": "GET,POST,OPTIONS",
});

const json = (req: Request, body: Json, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...cors(req),
    },
  });

const readToken = (req: Request) => {
  const h = req.headers;
  const auth = h.get("authorization");
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  const x = h.get("x-api-key");
  return (x && x.trim()) || null;
};

const vals = (env: Env, keys: string[]) =>
  keys
    .map((k) => (env as any)[k] as string | undefined)
    .filter(Boolean)
    .map((s) => s!.trim());

const apiTokens = (env: Env) => vals(env, ["API_KEY", "API", "API_TOKEN"]);
const adminTokens = (env: Env) => vals(env, ["ADMIN_TOKEN", "ADMIN_KEY"]);
const match = (token: string, pool: string[]) => pool.some((v) => v === token);

// ID: 32桁HEX（大文字）
const hexId = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

// ===== Handlers =====
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  // CORS preflight
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";

    // 公開アクション
    if (PUBLIC.has(action)) {
      if (action === "__actions__") return json(request, { ok: true, actions: ACTIONS });
      // 他に公開したいものがあればここに
    }

    // 認証
    const token = readToken(request);
    const isAdminAction = action.startsWith("admin.");
    if (!token) {
      return json(request, { ok: false, error: "unauthorized", need: isAdminAction ? "admin" : "api" }, 401);
    }
    const ok = isAdminAction ? match(token, adminTokens(env)) : match(token, apiTokens(env));
    if (!ok) {
      return json(request, { ok: false, error: "unauthorized", need: isAdminAction ? "admin" : "api" }, 401);
    }

    // ルーティング
    switch (action) {
      case "__echo__": {
        const raw = await request.json().catch(() => null);
        return json(request, { ok: true, action, raw, method: request.method });
      }

      case "lead.add": {
        const p = (await request.json().catch(() => ({}))) as any;
        const tenant = String(p.tenant || "").trim();
        const name = String(p.name || "").trim();
        const email = String(p.email || "").trim().toLowerCase();
        const channel = (p.channel ? String(p.channel) : "") || null;
        const note = (p.note ? String(p.note) : "") || null;

        if (!tenant || !name || !email) {
          return json(request, { ok: false, error: "bad_request", need: "tenant,name,email" }, 400);
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json(request, { ok: false, error: "invalid_email" }, 400);
        }

        const id = hexId();
        const now = Math.floor(Date.now() / 1000);
        // UPSERT（tenant+email で一意）
        await env.DB
          .prepare(
            `INSERT INTO leads (id, tenant, name, email, channel, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(tenant, email) DO UPDATE SET
               name=excluded.name, channel=excluded.channel, note=excluded.note`
          )
          .bind(id, tenant, name, email, channel, note, now)
          .run();

        return json(request, { ok: true, id });
      }

      case "lead.list": {
        const p = (await request.json().catch(() => ({}))) as any;
        const tenant = String(p.tenant || "").trim();
        const limit = Math.max(1, Math.min(1000, Number(p.limit || 100)));

        if (!tenant) return json(request, { ok: false, error: "bad_request", need: "tenant" }, 400);

        const r = await env.DB
          .prepare(
            `SELECT id, tenant, name, email, channel, note, created_at
             FROM leads WHERE tenant = ?1
             ORDER BY created_at DESC
             LIMIT ?2`
          )
          .bind(tenant, limit)
          .all();

        return json(request, { ok: true, items: r.results || [] });
      }

      case "admin.d1.tables": {
        const tables = await env.DB
          .prepare(`SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name`)
          .all();
        const indexes = await env.DB
          .prepare(`SELECT name, tbl_name, sql FROM sqlite_schema WHERE type='index' ORDER BY name`)
          .all();
        return json(request, { ok: true, tables: tables.results || [], indexes: indexes.results || [] });
      }

      case "admin.d1.migrate": {
        // 必要なテーブル＆インデックスを作成
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
          CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email
            ON leads (tenant, email);
        `);
        return json(request, { ok: true, migrated: true });
      }
    }

    return json(request, { ok: false, error: "unknown_action", action }, 404);
  } catch (e: any) {
    return json(request, { ok: false, error: "exception", detail: String(e?.message || e) }, 500);
  }
};
