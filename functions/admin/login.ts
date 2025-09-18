// /functions/admin/login.ts
// x-admin-key / JSON body.key / ?key= のいずれでも受け取り、admin_session Cookie を発行
export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;

  const url = new URL(request.url);
  const headerKey = request.headers.get("x-admin-key") || "";
  const body = await request.json().catch(() => ({} as any));
  const bodyKey = typeof body?.key === "string" ? body.key : "";
  const queryKey = url.searchParams.get("key") || "";
  const got = normalize(headerKey || bodyKey || queryKey);
  const need = normalize(env.ADMIN_KEY || "");

  if (!got) return j({ ok: false, error: "missing ADMIN_KEY" }, 400);
  if (!tse(got, need)) return j({ ok: false, error: "unauthorized" }, 401);

  // 署名付きセッショントークン（2パート: payload.signature）
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60 * 24 * 30; // 30日
  const payload = b64url(JSON.stringify({ role: "admin", iat: now, exp }));
  const sig = await hmacB64url(env.ADMIN_JWT_SECRET || "change-me", payload);
  const token = `${payload}.${sig}`;

  const cookie = [
    `admin_session=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 30}`,
  ].join("; ");

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": cookie,
      "cache-control": "no-store",
    },
  });
}

type Env = { ADMIN_KEY: string; ADMIN_JWT_SECRET: string };

// ===== utils =====
function normalize(s: string) {
  return (s || "").replace(/[\s\r\n]+/g, "");
}
function j(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function tse(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function b64url(input: string | Uint8Array) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function hmacB64url(secret: string, msg: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return b64url(new Uint8Array(sig));
}
