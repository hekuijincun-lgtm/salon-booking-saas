// functions/api.ts
// Cloudflare Pages Functions: /api?action=... でディスパッチ
interface Env {
  DB: D1Database;
  API_KEY?: string;      // 64hex
  ADMIN_TOKEN?: string;  // 64hex
  ADMIN_KEY?: string;    // 旧名が残っている可能性があるので対応
}

type JsonInit = ResponseInit & { headers?: Record<string, string> };

function json(data: unknown, init: JsonInit = {}): Response {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
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

function isHex64(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}

function pickToken(req: Request): string | null {
  // Authorization: Bearer ... 優先。なければ x-api-key / x-admin-key も拾う
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

// --- SQLユーティリティ ---
async function ensureSchema(env: Env): Promise<{ applied: boolean; detail?: string }> {
  // 正式な完全SQL（複文）。D1.execで一括実行
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
  // テーブル
  const t = await env.DB.prepare(
    `SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name`
  ).all();

  // インデックス
  const i = await env.DB.prepare(
    `SELECT name, tbl_name, sql FROM sqlite_schema WHERE type='index' ORDER BY name`
  ).all();

  return {
    tables: (t.results || []) as { name: string; sql: string | null }[],
    indexes: (i.results || []) as { name: string; tbl_name: string; sql: string | null }[],
  };
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const action = getQueryParam(url, "action");

  // Public: __actions__, __echo__（※__echo__はAPIキー要認証にしてもOK）
  // Private(API): lead.add, lead.list
  // Private(Admin): admin.d1.tables, admin.d1.migrate

  if (!action) {
    return badRequest("missing action");
  }

  // 便利関数：アクション一覧
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
      // 一覧（公開）
      case "__actions__": {
        return json({ ok: true, actions });
      }

      // エコー（APIキー要件を緩めたければここで外せる）
      case "__echo__": {
        if (!ensureApiAuth(env, request)) return unauthorized();
        const raw = (await safeJson(request)) ?? {};
        return json({
          ok: true,
          action,
          raw,
          method: request.method,
        });
      }

      // ========== API領域 ==========
      case "lead.add": {
        if (!ensureApiAuth(env, request)) return unauthorized();

        const body = (await safeJson(request)) ?? {};
        const tenant = String(body.tenant || "").trim();
        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim();
        const channel = body.channel == null ? null : String(body.channel);
        const note = body.note == null ? null : String(body.note);

        if (!tenant || !name || !email) {
          return badRequest("missing tenant/name/email");
        }

        const id = crypto.randomUUID();
        const now = Date.now(); // ← created_at（NOT NULL）を確実に埋める

        try {
          await env.DB.prepare(
            `INSERT INTO leads (id, tenant, name, email, channel, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
          )
            .bind(id, tenant, name, email, channel, note, now)
            .run();

          return json({ ok: true, id });
        } catch (e: any) {
          const msg = String(e?.message || e);

          // UNIQUE(tenant,email)は冪等扱いで成功パスに
          if (msg.includes("UNIQUE") || msg.includes("idx_leads_tenant_email")) {
            return json({ ok: true, id: null, duplicate: true });
          }

          // 代表的エラーもそのまま返してデバッグしやすく
          return json({ ok: false, error: msg }, { status: 500 });
        }
      }

      case "lead.list": {
        if (!ensureApiAuth(env, request)) return unauthorized();

        const body = (await safeJson(request)) ?? {};
        const tenant = body?.tenant ? String(body.tenant).trim() : "";

        const stmt = tenant
          ? env.DB.prepare(
              `SELECT id, tenant, name, email, channel, note, created_at
                 FROM leads
                WHERE tenant = ?1
                ORDER BY created_at DESC`
            ).bind(tenant)
          : env.DB.prepare(
              `SELECT id, tenant, name, email, channel, note, created_at
                 FROM leads
                ORDER BY created_at DESC
                LIMIT 100`
            );

        const rows = await stmt.all();
        return json({ ok: true, items: rows.results ?? [] });
      }

      // ========== Admin領域 ==========
      case "admin.d1.tables": {
        if (!ensureAdminAuth(env, request)) return unauthorized();

        const { tables, indexes } = await listTables(env);
        return json({ ok: true, tables, indexes });
      }

      case "admin.d1.migrate": {
        if (!ensureAdminAuth(env, request)) return unauthorized();

        const body = (await safeJson(request)) ?? {};
        // 将来 version 切り替えしたい時のための受け口だけ用意
        const version = String(body.version || "v3");

        if (version !== "v3") {
          // いまはv3のみ
          return json({ ok: false, error: "unsupported version" }, { status: 400 });
        }

        // スキーマを確実に適用
        const r = await ensureSchema(env);

        // 既に存在していてもOK（Pages上では idempotent にしたい）
        return json({
          ok: true,
          applied: r.applied,
          noop: !r.applied,
          detail: r.detail ?? null,
        });
      }

      default:
        return badRequest(`unknown action: ${action}`);
    }
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
};
