// functions/api.ts
// Pages Functions: /api?action=... にディスパッチ。POST/GET/OPTIONSすべてを受け付ける。
interface Env {
  DB: D1Database;
  API_KEY?: string;      // 64hex
  ADMIN_TOKEN?: string;  // 64hex
  ADMIN_KEY?: string;    // 互換
}

type JsonInit = ResponseInit & { headers?: Record<string, string> };

function json(data: unknown, init: JsonInit = {}): Response {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    // CORS（必要なら調整）
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, x-api-key, x-admin-key, content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    ...(init.headers || {}),
  };
  return new Response(JSON.stringify(data), { ...init, headers });
}

function badRequest(msg: string): Response {
  return json({ ok: false, error: msg }, { status: 400 });
}
function unauthorized(msg = "unauthorized"): Response {
  return json({ ok: false, error: msg }, { status: 401 });
}
function getQueryParam(url: URL, key: string): string | null {
  const v = url.searchParams.get(key);
  return v ? v.trim() : null;
}
function getBearer(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/.exec(h.trim());
  return m ? m[1].trim() : null;
}
function getHeader(req: Request, name: string): string | null {
  const v = req.headers.get(name) || req.headers.get(name.toLowerCase());
  return v ? v.trim() : null;
}
function normHex64(s?: string): string {
  return (s || "").replace(/\s+/g, "");
}
function pickToken(req: Request): string | null {
  return (
    getBearer(req) ||
    getHeader(req, "x-api-key") ||
    getHeader(req, "x-admin-key") ||
    null
  );
}
function ensureApiAuth(env: Env, req: Request): boolean {
  const presented = normHex64(pickToken(req) || "");
  const api = normHex64(env.API_KEY || "");
  return Boolean(api && presented && presented === api);
}
function ensureAdminAuth(env: Env, req: Request): boolean {
  const presented = normHex64(pickToken(req) || "");
  const a = normHex64(env.ADMIN_TOKEN || "");
  const b = normHex64(env.ADMIN_KEY || "");
  return Boolean(presented && (presented === a || (b && presented === b)));
}
async function safeJson<T = any>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
function getBodyOrQuery(req: Request, url: URL) {
  // POSTならJSON優先、GETでもクエリから拾えるようにする（405回避ワークアラウンド）
  const qp = (k: string) => getQueryParam(url, k) || "";
  return {
    async parse() {
      const b = (await safeJson(req)) ?? {};
      return {
        tenant: (b.tenant ?? qp("tenant") ?? "").toString().trim(),
        name:   (b.name   ?? qp("name")   ?? "").toString().trim(),
        email:  (b.email  ?? qp("email")  ?? "").toString().trim(),
        channel: b.channel ?? qp("channel") || null,
        note:    b.note    ?? qp("note")    || null,
        version: (b.version ?? qp("version") ?? "").toString().trim(),
      };
    },
  };
}

// --- Schema helpers ---
async function ensureSchema(env: Env): Promise<{ applied: boolean; detail?: string }> {
  const sql = `
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  channel TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email ON leads (tenant, email);
`;
  try {
    await env.DB.exec(sql);
    return { applied: true };
  } catch (e: any) {
    return { applied: false, detail: String(e?.message || e) };
  }
}
async function listTables(env: Env) {
  const t = await env.DB.prepare(
    `SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name`
  ).all();
  const i = await env.DB.prepare(
    `SELECT name, tbl_name, sql FROM sqlite_schema WHERE type='index' ORDER BY name`
  ).all();
  return {
    tables: (t.results || []) as { name: string; sql: string | null }[],
    indexes: (i.results || []) as { name: string; tbl_name: string; sql: string | null }[],
  };
}

// --- Main handler（全メソッド共通で呼ぶ） ---
const handler: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const action = getQueryParam(url, "action");

  if (method === "OPTIONS") {
    return json({ ok: true, preflight: true }, { status: 204 });
  }
  if (!action) {
    return badRequest("missing action");
  }

  const actions = [
    "__actions__",
    "__echo__",
    "lead.add",
    "lead.list",
    "admin.d1.tables",
    "admin.d1.migrate",
  ];

  try {
    switch (action) {
      case "__actions__": {
        // 公開（GETでもPOSTでもOK）
        return json({ ok: true, actions });
      }

      case "__echo__": {
        if (!ensureApiAuth(env, request)) return unauthorized();
        const raw = (await safeJson(request)) ?? {};
        return json({ ok: true, action, raw, method });
      }

      // ===== API =====
      case "lead.add": {
        if (!ensureApiAuth(env, request)) return unauthorized();
        const { parse } = getBodyOrQuery(request, url);
        const b = await parse();

        if (!b.tenant || !b.name || !b.email) {
          return badRequest("missing tenant/name/email");
        }

        const id = crypto.randomUUID();
        const now = Date.now();

        try {
          await env.DB.prepare(
            `INSERT INTO leads (id, tenant, name, email, channel, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
          ).bind(id, b.tenant, b.name, b.email, b.channel, b.note, now).run();

          return json({ ok: true, id, method });
        } catch (e: any) {
          const msg = String(e?.message || e);
          if (msg.includes("UNIQUE") || msg.includes("idx_leads_tenant_email")) {
            return json({ ok: true, id: null, duplicate: true, method });
          }
          return json({ ok: false, error: msg, method }, { status: 500 });
        }
      }

      case "lead.list": {
        if (!ensureApiAuth(env, request)) return unauthorized();
        const { parse } = getBodyOrQuery(request, url);
        const b = await parse();

        const stmt = b.tenant
          ? env.DB.prepare(
              `SELECT id, tenant, name, email, channel, note, created_at
                 FROM leads
                WHERE tenant = ?1
                ORDER BY created_at DESC`
            ).bind(b.tenant)
          : env.DB.prepare(
              `SELECT id, tenant, name, email, channel, note, created_at
                 FROM leads
                ORDER BY created_at DESC
                LIMIT 100`
            );

        const rows = await stmt.all();
        return json({ ok: true, items: rows.results ?? [], method });
      }

      // ===== Admin =====
      case "admin.d1.tables": {
        if (!ensureAdminAuth(env, request)) return unauthorized();
        const { tables, indexes } = await listTables(env);
        return json({ ok: true, tables, indexes, method });
      }

      case "admin.d1.migrate": {
        if (!ensureAdminAuth(env, request)) return unauthorized();
        const { parse } = getBodyOrQuery(request, url);
        const b = await parse();
        const version = b.version || "v3";
        if (version !== "v3") {
          return json({ ok: false, error: "unsupported version" }, { status: 400 });
        }
        const r = await ensureSchema(env);
        return json({ ok: true, applied: r.applied, noop: !r.applied, detail: r.detail ?? null, method });
      }

      default:
        return badRequest(`unknown action: ${action}`);
    }
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
};

// すべてのメソッドをこの handler に関連付け（405予防）
export const onRequest: PagesFunction<Env> = handler;
export const onRequestGet: PagesFunction<Env> = handler;
export const onRequestPost: PagesFunction<Env> = handler;
export const onRequestOptions: PagesFunction<Env> = handler;
