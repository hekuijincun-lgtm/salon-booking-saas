// functions/api.ts
// Pages Functions: /api?action=... でディスパッチ（GET/POST/OPTIONS全部OK）
const BUILD = "v2025-09-15-13:xx"; // ←適宜そのままでもOK（可視化用）

interface Env {
  DB: D1Database;
  API_KEY?: string;
  ADMIN_TOKEN?: string;
  ADMIN_KEY?: string; // 互換用（古い環境変数が残ってる場合）
}

type JsonInit = ResponseInit & { headers?: Record<string, string> };

function json(data: unknown, init: JsonInit = {}): Response {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, x-api-key, x-admin-key, content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    ...(init.headers || {}),
  };
  return new Response(JSON.stringify(data), { ...init, headers });
}
const badRequest     = (m:string)=> json({ok:false,error:m}, {status:400});
const unauthorized   = (m="unauthorized")=> json({ok:false,error:m}, {status:401});

const qp = (url:URL,k:string)=> (url.searchParams.get(k)||"").trim();
const bearer = (r:Request)=>{ const h=r.headers.get("authorization")||r.headers.get("Authorization"); if(!h) return null; const m=/^Bearer\s+(.+)$/.exec(h.trim()); return m?m[1].trim():null; };
const hval = (r:Request,n:string)=> (r.headers.get(n)||r.headers.get(n.toLowerCase())||"").trim();
const norm = (s?:string)=> (s||"").replace(/\s+/g,"");
const pick = (r:Request)=> bearer(r) || hval(r,"x-api-key") || hval(r,"x-admin-key") || null;

function okApi(env:Env, r:Request){ const p=norm(pick(r)||""); return !!(env.API_KEY && p && p===norm(env.API_KEY)); }
function okAdmin(env:Env, r:Request){
  const p=norm(pick(r)||""); const a=norm(env.ADMIN_TOKEN||""); const b=norm(env.ADMIN_KEY||"");
  return !!(p && (p===a || (b && p===b)));
}

async function safeJson<T=any>(req:Request):Promise<T|null>{ try{ return await req.json() as T }catch{ return null } }
function bodyOrQuery(req:Request,url:URL){
  const q = (k:string)=> qp(url,k) || "";
  return {
    async parse(){
      const b = (await safeJson(req)) ?? {};
      return {
        tenant: (b.tenant ?? q("tenant") ?? "").toString().trim(),
        name:   (b.name   ?? q("name")   ?? "").toString().trim(),
        email:  (b.email  ?? q("email")  ?? "").toString().trim(),
        channel: b.channel ?? q("channel") || null,
        note:    b.note    ?? q("note")    || null,
        version: (b.version ?? q("version") ?? "").toString().trim(),
      };
    }
  }
}

// --- D1 schema (idempotent / super light) ---
async function ensureSchema(env:Env): Promise<void> {
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
  await env.DB.exec(sql);
}
async function listTables(env:Env){
  const t = await env.DB.prepare(`SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name`).all();
  const i = await env.DB.prepare(`SELECT name, tbl_name, sql FROM sqlite_schema WHERE type='index' ORDER BY name`).all();
  return { tables:(t.results||[]) as any[], indexes:(i.results||[]) as any[] };
}

// 共通ハンドラ
const handler: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const action = qp(url, "action");

  if (method === "OPTIONS") return json({ ok:true, preflight:true, build: BUILD }, { status:204 });
  if (!action) return badRequest("missing action");

  const actions = ["__actions__","__build__","__echo__","lead.add","lead.list","admin.d1.tables","admin.d1.migrate"];

  try {
    switch (action) {
      case "__actions__": return json({ ok:true, actions, build: BUILD });
      case "__build__" :  return json({ ok:true, build: BUILD, method });

      case "__echo__": {
        if (!okApi(env, request)) return unauthorized();
        const raw = (await safeJson(request)) ?? {};
        return json({ ok:true, action, raw, method, build: BUILD });
      }

      // ===== API =====
      case "lead.add": {
        if (!okApi(env, request)) return unauthorized();
        await ensureSchema(env); // ← どの環境でも自己修復
        const { parse } = bodyOrQuery(request, url);
        const b = await parse();
        if (!b.tenant || !b.name || !b.email) return badRequest("missing tenant/name/email");

        const id = crypto.randomUUID();
        const now = Date.now();
        try {
          await env.DB.prepare(
            `INSERT INTO leads (id, tenant, name, email, channel, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
          ).bind(id, b.tenant, b.name, b.email, b.channel, b.note, now).run();

          return json({ ok:true, id, method, build: BUILD });
        } catch (e:any) {
          const msg = String(e?.message || e);
          if (msg.includes("UNIQUE") || msg.includes("idx_leads_tenant_email")) {
            return json({ ok:true, id:null, duplicate:true, method, build: BUILD });
          }
          return json({ ok:false, error: msg, where:"lead.add/insert", method, build: BUILD }, { status:500 });
        }
      }

      case "lead.list": {
        if (!okApi(env, request)) return unauthorized();
        await ensureSchema(env);
        const { parse } = bodyOrQuery(request, url);
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
        return json({ ok:true, items: rows.results ?? [], method, build: BUILD });
      }

      // ===== Admin =====
      case "admin.d1.tables": {
        if (!okAdmin(env, request)) return unauthorized();
        const x = await listTables(env);
        return json({ ok:true, ...x, method, build: BUILD });
      }

      case "admin.d1.migrate": {
        if (!okAdmin(env, request)) return unauthorized();
        const { parse } = bodyOrQuery(request, url);
        const b = await parse();
        if ((b.version || "v3") !== "v3") return badRequest("unsupported version");
        await ensureSchema(env);
        return json({ ok:true, applied:true, noop:false, detail:null, method, build: BUILD });
      }

      default: return badRequest(`unknown action: ${action}`);
    }
  } catch (e:any) {
    return json({ ok:false, error:String(e?.message || e), where:"top-level", build: BUILD }, { status:500 });
  }
};

// すべてのHTTPメソッドを紐付け（405予防）
export const onRequest: PagesFunction<Env> = handler;
export const onRequestGet: PagesFunction<Env> = handler;
export const onRequestPost: PagesFunction<Env> = handler;
export const onRequestOptions: PagesFunction<Env> = handler;
