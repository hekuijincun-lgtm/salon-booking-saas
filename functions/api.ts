// functions/api.ts
// Cloudflare Pages Functions (TypeScript) — drop-in replacement

// 型はあってもなくてもOK。ビルド環境に合わせて調整可。
export interface Env {
  DB: D1Database;
  API_KEY?: string;
  ADMIN_TOKEN?: string;
  ADMIN_KEY?: string;
}

type Json = Record<string, any>;
const json = (obj: Json, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const PUBLIC_ACTIONS = [
  "__actions__",
  "__echo__",
  "lead.add",
  "lead.list",
  "admin.d1.tables",
  "admin.d1.migrate",
];

// ===== helpers =====
const getAction = (url: URL) => url.searchParams.get("action") || "";
const isHex64 = (s?: string | null) => !!s && /^[0-9a-f]{64}$/.test(s);

const readAuth = (req: Request) => {
  const h = req.headers;
  const a = h.get("authorization") || h.get("Authorization");
  if (a && a.toLowerCase().startsWith("bearer ")) return a.slice(7).trim();
  const x = h.get("x-api-key") || h.get("X-API-Key");
  if (x) return x.trim();
  return "";
};

const checkApi = (token: string, env: Env) => {
  const pairs: Array<[string, string | undefined]> = [["API_KEY", env.API_KEY]];
  for (const [name, val] of pairs) if (isHex64(val) && token === val) return name;
  return "";
};

const checkAdmin = (token: string, env: Env) => {
  const pairs: Array<[string, string | undefined]> = [
    ["ADMIN_TOKEN", env.ADMIN_TOKEN],
    ["ADMIN_KEY", env.ADMIN_KEY],
  ];
  for (const [name, val] of pairs) if (isHex64(val) && token === val) return name;
  return "";
};

const readJson = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
};

// ===== handlers =====
const handleEcho = async (req: Request) => {
  const raw = await readJson(req);
  return json({ ok: true, action: "__echo__", raw, method: req.method });
};

const ensureSchema = async (env: Env) => {
  // 共通スキーマ定義（冪等）
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email
      ON leads (tenant, email);
  `;
  await env.DB.exec(sql);
};

const handleLeadAdd = async (env: Env, payload: any) => {
  const tenant = String(payload?.tenant ?? "").trim();
  const name = String(payload?.name ?? "").trim();
  const email = String(payload?.email ?? "").trim().toLowerCase();
  const channel = String(payload?.channel ?? "").trim() || null;
  const note = String(payload?.note ?? "").trim() || null;

  if (!tenant || !name || !email) {
    return json({ ok: false, error: "bad_request", need: "tenant,name,email" }, 400);
  }

  await ensureSchema(env);

  const now = Math.floor(Date.now() / 1000);
  // 既存（tenant+email）は上書き更新＝UPSERTの明示実装
  const existing = await env.DB
    .prepare("SELECT id FROM leads WHERE tenant=? AND email=?")
    .bind(tenant, email)
    .first<{ id?: string }>();

  if (existing?.id) {
    await env.DB
      .prepare(
        "UPDATE leads SET name=?, channel=?, note=?, created_at=? WHERE id=?"
      )
      .bind(name, channel, note, now, existing.id)
      .run();
    return json({ ok: true, id: existing.id });
  }

  // Uppercase 32hex のID（既存表示と近いフォーマット）
  const id = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  await env.DB
    .prepare(
      "INSERT INTO leads (id, tenant, name, email, channel, note, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .bind(id, tenant, name, email, channel, note, now)
    .run();

  return json({ ok: true, id });
};

const handleLeadList = async (env: Env, payload: any) => {
  const tenant = String(payload?.tenant ?? "").trim();
  if (!tenant) return json({ ok: false, error: "bad_request", need: "tenant" }, 400);

  // スキーマが未作成でも空配列を返せるよう、先にensure
  await ensureSchema(env);

  const rows = await env.DB
    .prepare("SELECT * FROM leads WHERE tenant = ? ORDER BY created_at DESC")
    .bind(tenant)
    .all();

  return json({ ok: true, items: rows.results ?? [] });
};

const handleAdminTables = async (env: Env) => {
  const tables = await env.DB
    .prepare("SELECT name, sql FROM sqlite_schema WHERE type='table'")
    .all();
  const indexes = await env.DB
    .prepare("SELECT name, tbl_name, sql FROM sqlite_schema WHERE type='index'")
    .all();
  return json({
    ok: true,
    tables: tables.results ?? [],
    indexes: indexes.results ?? [],
  });
};

const handleAdminMigrate = async (env: Env) => {
  // ここを冪等＆安全に（重複時はOK扱いにする）
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email
      ON leads (tenant, email);
  `;
  try {
    await env.DB.exec(sql);
    return json({ ok: true, applied: true });
  } catch (e: any) {
    // 既にある/フォーマット差などは no-op としてOK返す（運用優先）
    return json({
      ok: true,
      applied: false,
      noop: true,
      detail: String(e),
    });
  }
};

// ===== entrypoint (Pages Functions) =====
export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const action = getAction(url);

  // 公開：アクション一覧
  if (request.method === "GET" && action === "__actions__") {
    return json({ ok: true, actions: PUBLIC_ACTIONS });
  }

  // 認可
  const token = readAuth(request);
  const needsAdmin = action.startsWith("admin.");
  const needsApi = ["__echo__", "lead.add", "lead.list"].includes(action);

  if (needsAdmin) {
    const matched = checkAdmin(token, env);
    if (!matched) return json({ ok: false, error: "unauthorized", need: "admin" }, 401);
  } else if (needsApi) {
    const matched = checkApi(token, env);
    if (!matched) return json({ ok: false, error: "unauthorized", need: "api" }, 401);
  }

  // ルーティング
  switch (action) {
    case "__echo__":
      return handleEcho(request);
    case "lead.add": {
      const payload = await readJson(request);
      return handleLeadAdd(env, payload);
    }
    case "lead.list": {
      const payload = await readJson(request);
      return handleLeadList(env, payload);
    }
    case "admin.d1.tables":
      return handleAdminTables(env);
    case "admin.d1.migrate":
      return handleAdminMigrate(env);
    case "__actions__":
      return json({ ok: true, actions: PUBLIC_ACTIONS });
    default:
      return json({ ok: false, error: "unknown_action", action }, 404);
  }
};
