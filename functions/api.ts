// functions/api.ts
// Pages Functions (GET/POST/OPTIONS全部OK) + ビルド表示 + D1自己診断 + 例外安全化
const BUILD = "v2025-09-15-verify-db-02";

interface Env {
  DB?: D1Database;            // ← PagesのD1 Binding名は "DB" に合わせる
  API_KEY?: string;
  ADMIN_TOKEN?: string;
  ADMIN_KEY?: string;         // 互換
}

type JsonInit = ResponseInit & { headers?: Record<string,string> };
const json = (data:any, init:JsonInit={}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-api-key, x-admin-key, content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      ...(init.headers||{})
    }
  });
const bad = (m:string)=> json({ok:false,error:m,build:BUILD}, {status:400});
const una = (m="unauthorized")=> json({ok:false,error:m,build:BUILD}, {status:401});

const qp = (u:URL,k:string)=> (u.searchParams.get(k)||"").trim();
const h  = (r:Request,n:string)=> (r.headers.get(n)||r.headers.get(n.toLowerCase())||"").trim();
const bearer = (r:Request)=>{ const a=h(r,"authorization"); const m=/^Bearer\s+(.+)$/.exec(a); return m?m[1].trim():""; };
const pick = (r:Request)=> bearer(r) || h(r,"x-api-key") || h(r,"x-admin-key");
const norm = (s?:string)=> (s||"").replace(/\s+/g,"");
const okApi   = (e:Env,r:Request)=> !!(e.API_KEY && norm(pick(r))===norm(e.API_KEY));
const okAdmin = (e:Env,r:Request)=> { const p=norm(pick(r)); return !!(p && (p===norm(e.ADMIN_TOKEN||"") || (e.ADMIN_KEY && p===norm(e.ADMIN_KEY)))); };
const safeJson = async<T=any>(req:Request):Promise<T|null> => { try{ return await req.json() as T }catch{ return null } };
const bodyOrQuery = (req:Request,u:URL)=>({ parse: async()=>{
  const b = (await safeJson(req)) ?? {};
  return {
    tenant: (b.tenant ?? qp(u,"tenant") ?? "").toString().trim(),
    name:   (b.name   ?? qp(u,"name")   ?? "").toString().trim(),
    email:  (b.email  ?? qp(u,"email")  ?? "").toString().trim(),
    channel: b.channel ?? qp(u,"channel") || null,
    note:    b.note    ?? qp(u,"note")    || null,
    version: (b.version ?? qp(u,"version") ?? "").toString().trim(),
  };
}});

// === D1 安全ユーティリティ ===
function assertDB(env:Env){
  // D1未バインドだと "1101" 落ちを起こしやすいので明示的に検査
  if (!env.DB || typeof (env.DB as any).exec !== "function") {
    throw new Error("D1 binding 'DB' is missing. Go to Pages > Settings > Functions > D1 bindings and add 'DB' for both Production & Preview.");
  }
}
async function ensureSchema(env:Env){
  assertDB(env);
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
  await env.DB!.exec(sql);
}
async function dbPing(env:Env){
  assertDB(env);
  const r = await env.DB!.prepare("SELECT 1 as ok").all();
  return r.results?.[0]?.ok === 1;
}
async function listTables(env:Env){
  assertDB(env);
  const t = await env.DB!.prepare(`SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name`).all();
  const i = await env.DB!.prepare(`SELECT name, tbl_name, sql FROM sqlite_schema WHERE type='index' ORDER BY name`).all();
  return { tables:(t.results||[]), indexes:(i.results||[]) };
}

// === メインハンドラ ===
const handler: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const action = qp(url,"action");
  if (method==="OPTIONS") return json({ok:true,preflight:true,build:BUILD},{status:204});
  if (!action) return bad("missing action");

  const actions = ["__actions__","__build__","__echo__","__diag.db","lead.add","lead.list","admin.d1.tables","admin.d1.migrate"];

  try {
    switch (action) {
      case "__actions__": return json({ok:true,actions,build:BUILD});
      case "__build__" :  return json({ok:true,build:BUILD,method});

      case "__echo__": {
        if (!okApi(env, request)) return una();
        const raw = (await safeJson(request)) ?? {};
        return json({ok:true,action,raw,method,build:BUILD});
      }

      case "__diag.db": {
        try {
          const present = !!env.DB;
          let ping = false, note = "";
          if (present) {
            try { ping = await dbPing(env) } catch (e:any) { note = String(e?.message||e) }
          }
          return json({ok:true, present, ping, note, build:BUILD});
        } catch (e:any) {
          return json({ok:false, error:String(e?.message||e), where:"__diag.db", build:BUILD}, {status:500});
        }
      }

      // ===== API =====
      case "lead.add": {
        if (!okApi(env, request)) return una();
        const b = await bodyOrQuery(request,url).parse();
        if (!b.tenant || !b.name || !b.email) return bad("missing tenant/name/email");
        try {
          await ensureSchema(env);
          await env.DB!.prepare(
            `INSERT INTO leads (id, tenant, name, email, channel, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
          ).bind(crypto.randomUUID(), b.tenant, b.name, b.email, b.channel, b.note, Date.now()).run();
          return json({ok:true,method,build:BUILD});
        } catch (e:any) {
          const msg=String(e?.message||e);
          if (msg.includes("UNIQUE")||msg.includes("idx_leads_tenant_email")) return json({ok:true,duplicate:true,method,build:BUILD});
          return json({ok:false,error:msg,where:"lead.add",build:BUILD},{status:500});
        }
      }

      case "lead.list": {
        if (!okApi(env, request)) return una();
        try {
          await ensureSchema(env);
          const b = await bodyOrQuery(request,url).parse();
          const stmt = b.tenant
            ? env.DB!.prepare(`SELECT id,tenant,name,email,channel,note,created_at FROM leads WHERE tenant=?1 ORDER BY created_at DESC`).bind(b.tenant)
            : env.DB!.prepare(`SELECT id,tenant,name,email,channel,note,created_at FROM leads ORDER BY created_at DESC LIMIT 100`);
          const rows = await stmt.all();
          return json({ok:true,items:rows.results||[],method,build:BUILD});
        } catch (e:any) {
          return json({ok:false,error:String(e?.message||e),where:"lead.list",build:BUILD},{status:500});
        }
      }

      // ===== Admin =====
      case "admin.d1.tables": {
        if (!okAdmin(env, request)) return una();
        try {
          const x = await listTables(env);
          return json({ok:true,...x,method,build:BUILD});
        } catch (e:any) {
          return json({ok:false,error:String(e?.message||e),where:"admin.d1.tables",build:BUILD},{status:500});
        }
      }

      case "admin.d1.migrate": {
        if (!okAdmin(env, request)) return una();
        try {
          await ensureSchema(env);
          return json({ok:true,applied:true,noop:false,detail:null,method,build:BUILD});
        } catch (e:any) {
          return json({ok:false,error:String(e?.message||e),where:"admin.d1.migrate",build:BUILD},{status:500});
        }
      }

      default: return bad(`unknown action: ${action}`);
    }
  } catch (e:any) {
    // ここに来ても 1101 にはならず JSON を返す
    return json({ok:false,error:String(e?.message||e),where:"top-level",build:BUILD},{status:500});
  }
};

// 405予防（すべてのHTTPメソッドにバインド）
export const onRequest:        PagesFunction<Env> = handler;
export const onRequestGet:     PagesFunction<Env> = handler;
export const onRequestPost:    PagesFunction<Env> = handler;
export const onRequestOptions: PagesFunction<Env> = handler;
