// functions/api/add-lead.ts
// Public API for form & AJAX
//   GET      -> { ok:true, alive:true }  (初回でスキーマ作成)
//   OPTIONS  -> 204 No Content (CORS)
//   POST     -> upsert lead (tenant+email ユニーク)
//
// NOTE: D1 の「incomplete input」対策として、DDL は 1 ステートメントずつ
//       prepare().run() で実行（exec/複文は使わない）

interface Env { DB?: D1Database }
const BUILD = "v2025-09-16-form-endpoint-API-opts-204d";

// ----------------- helpers -----------------
function cors(req: Request): Record<string, string> {
  const reqHdr = req.headers.get("access-control-request-headers")
    || "content-type,cf-turnstile-response";
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": reqHdr,
    "access-control-max-age": "86400",
    "vary": "origin, access-control-request-method, access-control-request-headers",
  };
}
function j(data: any, init: ResponseInit = {}, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
      ...(init.headers || {}),
    },
  });
}
const OK  = (req: Request, obj: any = {}) => j({ ok:true, ...obj, build:BUILD }, { status:200 }, cors(req));
const NG  = (req: Request, msg: string, status=400) => j({ ok:false, error:msg, build:BUILD }, { status }, cors(req));

async function bodyJSON<T=any>(req: Request): Promise<T|null> {
  try { return await req.json() as T } catch { return null }
}
function assertDB(env: Env) {
  if (!env.DB || typeof (env.DB as any).prepare !== "function") {
    throw new Error("D1 binding 'DB' is missing. Pages > Settings > Functions > Bindings で Name=DB を設定してね");
  }
}

// 重要：DDLは各1文・単行化して prepare().run() で実行
async function ensureSchema(env: Env) {
  assertDB(env);
  const db = env.DB!;

  await db.prepare(
    "CREATE TABLE IF NOT EXISTS leads (" +
    "id TEXT PRIMARY KEY, " +
    "tenant TEXT NOT NULL, " +
    "name TEXT NOT NULL, " +
    "email TEXT NOT NULL, " +
    "channel TEXT, " +
    "note TEXT, " +
    "created_at INTEGER NOT NULL" +
    ")"
  ).run();

  await db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email ON leads (tenant, email)"
  ).run();
}

// ----------------- handlers -----------------
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureSchema(env);
    return OK(request, { alive:true });
  } catch (e:any) {
    return NG(request, String(e?.message || e), 500);
  }
};

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return new Response(null, { status:204, headers: { ...cors(request) } });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const b = (await bodyJSON(request)) ?? {};
    const tenant  = (b.tenant  ?? "").toString().trim();
    const name    = (b.name    ?? "").toString().trim();
    const email   = (b.email   ?? "").toString().trim().toLowerCase();
    const channel = (b.channel ?? null) as string | null;
    const note    = (b.note    ?? null) as string | null;

    if (!tenant || !name || !email) return NG(request, "missing tenant/name/email");

    await ensureSchema(env);

    const now = Date.now();
    await env.DB!.prepare(
      "INSERT INTO leads (id, tenant, name, email, channel, note, created_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) " +
      "ON CONFLICT(tenant, email) DO UPDATE SET " +
      "name=excluded.name, channel=excluded.channel, note=excluded.note, created_at=excluded.created_at"
    ).bind(crypto.randomUUID(), tenant, name, email, channel, note, now).run();

    return OK(request, { upsert:true });
  } catch (e:any) {
    return NG(request, String(e?.message || e), 500);
  }
};
