// functions/api/add-lead.ts
// Cloudflare Pages Functions - Public API: /api/add-lead
// ✅ OPTIONS で 204(No Content) + CORS、本文なし
// ✅ GET: alive ping
// ✅ POST: lead を D1 に upsert（同じ tenant+email は重複扱いで ok:true）

interface Env { DB?: D1Database }
const BUILD = "v2025-09-16-form-endpoint-API-opts-204b";

// ---- CORS helpers ----
function corsHeaders(req: Request): Record<string, string> {
  // 必要なら Origin を絞る。今回は * でOK（認証なし・Cookie未使用）
  const reqHdr = req.headers.get("access-control-request-headers") || "content-type,cf-turnstile-response";
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": reqHdr,
    "access-control-max-age": "86400",
    "vary": "origin, access-control-request-method, access-control-request-headers",
  };
}
function json(data: any, init: ResponseInit = {}, extraHdr: Record<string,string> = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHdr,
      ...(init.headers || {}),
    },
  });
}
const bad = (req: Request, msg: string, status = 400) => json({ ok: false, error: msg, build: BUILD }, { status }, corsHeaders(req));
const ok  = (req: Request, obj: any = {}) => json({ ok: true, ...obj, build: BUILD }, { status: 200 }, corsHeaders(req));

async function bodyJSON<T = any>(req: Request): Promise<T | null> {
  try { return await req.json() as T } catch { return null }
}
function assertDB(env: Env) {
  if (!env.DB || typeof (env.DB as any).prepare !== "function") {
    throw new Error("D1 binding 'DB' is missing. Pages > Settings > Functions > Bindings で Name=DB を設定してね");
  }
}
async function ensureSchema(env: Env) {
  assertDB(env);
  await env.DB!.exec(`
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
  `);
}

// --- GET: alive ---
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try { await ensureSchema(env); return ok(request, { alive: true }); }
  catch (e: any) { return bad(request, String(e?.message || e), 500); }
};

// --- OPTIONS: preflight (204 No Content, 本文なし！) ---
export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return new Response(null, { status: 204, headers: { ...corsHeaders(request) } });
};

// --- POST: save lead ---
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const b = (await bodyJSON(request)) ?? {};
    const tenant  = (b.tenant  ?? "").toString().trim();
    const name    = (b.name    ?? "").toString().trim();
    const email   = (b.email   ?? "").toString().trim().toLowerCase();
    const channel = (b.channel ?? null) as string | null;
    const note    = (b.note    ?? null) as string | null;

    if (!tenant || !name || !email) return bad(request, "missing tenant/name/email");

    await ensureSchema(env);

    try {
      await env.DB!.prepare(
        `INSERT INTO leads (id, tenant, name, email, channel, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      ).bind(crypto.randomUUID(), tenant, name, email, channel, note, Date.now()).run();
      return ok(request);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("UNIQUE") || msg.includes("idx_leads_tenant_email")) {
        // 同じメールは idempotent に成功扱い
        return ok(request, { duplicate: true });
      }
      return bad(request, msg, 500);
    }
  } catch (e: any) {
    return bad(request, String(e?.message || e), 500);
  }
};
