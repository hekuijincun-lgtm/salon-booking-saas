// /functions/admin/login.ts
// 管理ログインAPI：x-admin-key / body.key / ?key= のいずれでも受付
// Secrets に改行が混ざっていても normalize で吸収して比較します。

type Env = { ADMIN_KEY: string; ADMIN_JWT_SECRET: string };

// ===== utils =====
const norm = (s: string | null | undefined) =>
  (s ?? "").replace(/[\r\n]+$/g, "").trim();

const json = (d: any, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const tse = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

const toB64url = (u8: Uint8Array) => {
  let s = "";
  for (const x of u8) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

async function makeToken(payload: any, secret: string) {
  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return `${toB64url(data)}.${toB64url(new Uint8Array(sig))}`;
}

// ===== handler =====
export async function onRequest({ request, env }: { request: Request; env: Env }) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const url = new URL(request.url);

  // 3経路でキーを受け付け（header / body / query）
  const hdrKey = norm(request.headers.get("x-admin-key"));
  const qsKey = norm(url.searchParams.get("key"));

  let bodyKey: string | undefined = undefined;
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    const j = await request.json().catch(() => ({} as any));
    if (typeof j?.key === "string") bodyKey = norm(j.key);
  }

  const candidate = bodyKey || hdrKey || qsKey || "";
  const envKey = norm(env.ADMIN_KEY);

  if (!candidate) return json({ ok: false, error: "missing key" }, 401);
  if (!envKey) return json({ ok: false, error: "missing ADMIN_KEY" }, 500);

  // 正規化後の長さ/値で比較（デバッグしやすいように length も返す）
  if (candidate.length !== envKey.length) {
    return json(
      { ok: false, error: "length mismatch", got: candidate.length, need: envKey.length },
      401
    );
  }
  if (!tse(candidate, envKey)) return json({ ok: false, error: "mismatch" }, 401);

  if (!env.ADMIN_JWT_SECRET) return json({ ok: false, error: "missing ADMIN_JWT_SECRET" }, 500);

  const now = Math.floor(Date.now() / 1000);
  const token = await makeToken({ role: "admin", iat: now, exp: now + 60 * 60 * 24 * 7 }, env.ADMIN_JWT_SECRET);

  const h = new Headers({ "content-type": "application/json; charset=utf-8" });
  h.append(
    "set-cookie",
    `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${60 * 60 * 24 * 7}`
  );
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
}
