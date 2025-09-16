// functions/api/add-lead.ts
// Public form endpoint for Cloudflare Pages Functions (no API key).
interface Env { DB?: D1Database }
const BUILD = "v2025-09-16-form-endpoint-API";

type JsonInit = ResponseInit & { headers?: Record<string,string> };
const json = (d:any,i:JsonInit={}) => new Response(JSON.stringify(d), {
  ...i,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    // CORS (cross-originでも安心)
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,cf-turnstile-response",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    ...(i.headers||{})
  }
});
const bad = (m:string,s=400)=>json({ok:false,error:m,build:BUILD},{status:s});

const safeJson = async<T=any>(req:Request):Promise<T|null>=>{
  try { return await req.json() as T } catch { return null }
};

function assertDB(env:Env){
  if (!env.DB || typeof (env.DB as any).prepare !== "function") {
    throw new Error("D1 binding 'DB' is missing. Set Pages > Settings > Functions > D1 bindings: Name=DB");
  }
}
async function ensureSchema(env:Env) {
  assertDB(env);
  await env.DB!.prepare(
    `CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      tenant TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      channel TEXT,
      note TEXT,
      created_at INTEGER NOT NULL
    )`
  ).run();
  await env.DB!.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email ON leads (tenant, email)`
  ).run();
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try { await ensureSchema(env); return json({ ok:true, alive:true, build:BUILD }) }
  catch (e:any) { return bad(String(e?.message||e), 500) }
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  json({ ok:true, preflight:true, build:BUILD }, { status:204 });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const b = (await safeJson(request)) ?? {};
    const tenant = (b.tenant ?? "").toString().trim();
    const name   = (b.name   ?? "").toString().trim();
    const email  = (b.email  ?? "").toString().trim().toLowerCase();
    const channel= (b.channel?? null) as string | null;
    const note   = (b.note   ?? null) as string | null;
    if (!tenant || !name || !email) return bad("missing tenant/name/email");

    await ensureSchema(env);
    try {
      await env.DB!.prepare(
        `INSERT INTO leads (id, tenant, name, email, channel, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      ).bind(crypto.randomUUID(), tenant, name, email, channel, note, Date.now()).run();
      return json({ ok:true, build:BUILD });
    } catch (e:any) {
      const msg = String(e?.message||e);
      if (msg.includes("UNIQUE") || msg.includes("idx_leads_tenant_email")) {
        // 既存は上書き保存してもOKにする運用なら UPDATE にしても良い
        return json({ ok:true, duplicate:true, build:BUILD });
      }
      return bad(msg, 500);
    }
  } catch (e:any) {
    return bad(String(e?.message||e), 500);
  }
};
