// /functions/admin/login.ts
export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;

  // --- 取り出し（ヘッダ優先 → JSON → クエリ） ---
  const url = new URL(request.url);
  const headerKey = request.headers.get("x-admin-key") || "";
  const body = await request.json().catch(() => ({} as any));
  const bodyKey = typeof body?.key === "string" ? body.key : "";
  const queryKey = url.searchParams.get("key") || "";
  const got = normalizeKey(headerKey || bodyKey || queryKey);
  const need = normalizeKey(env.ADMIN_KEY || "");

  if (!got) {
    return j({ ok: false, error: "missing ADMIN_KEY" }, 400);
  }
  if (!tse(got, need)) {
    return j({ ok: false, error: "unauthorized" }, 401);
  }

  // --- 2パート署名トークンを発行（既存バリデータ互換）---
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60 * 24 * 30; // 30日
  const payloadObj = { role: "admin", iat: now, exp };
  const payload = b64url(JSON.stringify(payloadObj));
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

// ===== utils =====
type Env = {
  ADMIN_KEY: string;
  ADMIN_JWT_SECRET: string;
};

function normalizeKey(s: string): string {
  // 改行やスペース混入（65桁問題）を吸収
  return (s || "").replace(/[\s\r\n]+/g, "");
}

// タイミング安全比較
function tse(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function j(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function b64url(str: string | Uint8Array): string {
  const bytes = typeof str === "string" ? new TextEncoder().encode(str) : str;
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacB64url(secret: string, msg: string): Promise<string> {
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
