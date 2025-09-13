// /functions/admin/login.ts (debug + fallback)
type Env = { ADMIN_KEY: string; ADMIN_JWT_SECRET: string };

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  try {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const url = new URL(request.url);
    const qsKey  = url.searchParams.get("key") ?? undefined;
    const hdrKey = request.headers.get("x-admin-key") ?? undefined;

    let bodyKey: string | undefined = undefined;
    if ((request.headers.get("content-type") || "").includes("application/json")) {
      const j = await request.json().catch(() => ({} as any));
      bodyKey = typeof j?.key === "string" ? j.key : undefined;
    }

    const candidate = bodyKey ?? hdrKey ?? qsKey;
    const envKey = env.ADMIN_KEY || "";

    if (!candidate) {
      return json({ ok:false, error:"missing key", hint:'send {"key":"..."} or x-admin-key header' }, 401);
    }
    if (!envKey) {
      return json({ ok:false, error:"missing ADMIN_KEY" }, 500);
    }
    if (candidate.length !== envKey.length) {
      return json({ ok:false, error:"length mismatch", got:candidate.length, need:envKey.length }, 401);
    }
    if (!tse(candidate, envKey)) {
      return json({ ok:false, error:"mismatch" }, 401);
    }
    if (!env.ADMIN_JWT_SECRET) {
      return json({ ok:false, error:"missing ADMIN_JWT_SECRET" }, 500);
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = { role: "admin", iat: now, exp: now + 60 * 60 * 24 * 7 }; // 7日
    const token = await makeToken(payload, env.ADMIN_JWT_SECRET);

    const h = new Headers({ "content-type": "application/json; charset=utf-8" });
    h.append("set-cookie", `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${60*60*24*7}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
  } catch (err: any) {
    return json({ ok:false, error:String(err), stack: err?.stack ?? null }, 500);
  }
}

function json(d:any,s=200){return new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json; charset=utf-8'}})}
function tse(a:string,b:string){ if(a?.length!==b?.length) return false; let d=0; for(let i=0;i<a.length;i++) d|=a.charCodeAt(i)^b.charCodeAt(i); return d===0 }
async function makeToken(payload:any, secret:string){
  const enc=new TextEncoder(); const data=enc.encode(JSON.stringify(payload));
  const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,data);
  return `${toB64url(data)}.${toB64url(new Uint8Array(sig))}`;
}
function toB64url(u8:Uint8Array){
  const tbl="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out="", i=0; for(; i+2<u8.length; i+=3){ const n=(u8[i]<<16)|(u8[i+1]<<8)|u8[i+2]; out+=tbl[(n>>>18)&63]+tbl[(n>>>12)&63]+tbl[(n>>>6)&63]+tbl[n&63]; }
  if(i<u8.length){ const a=u8[i], b=i+1<u8.length?u8[i+1]:0, n=(a<<16)|(b<<8); out+=tbl[(n>>>18)&63]+tbl[(n>>>12)&63]+(i+1<u8.length?tbl[(n>>>6)&63]:"=")+"="; }
  return out.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
