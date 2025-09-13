// /functions/admin/login.ts
type Env = { ADMIN_KEY: string; ADMIN_JWT_SECRET: string };

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { key } = await request.json().catch(() => ({} as any));
  if (!key || !tse(key, env.ADMIN_KEY)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // 7日セッション
  const now = Math.floor(Date.now() / 1000);
  const payload = { role: "admin", iat: now, exp: now + 60 * 60 * 24 * 7 };
  const token = await makeToken(payload, env.ADMIN_JWT_SECRET);

  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  headers.append(
    "set-cookie",
    `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${60 * 60 * 24 * 7}`
  );

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function tse(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function makeToken(payload: any, secret: string) {
  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  const p = b64url(data);
  const s = b64url(sig);
  return `${p}.${s}`;
}

function b64url(buf: ArrayBuffer | Uint8Array) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
