// /functions/api.ts — 管理は x-admin-key or admin_session、公開APIは Bearer 必須
type Env = {
  ADMIN_KEY: string;
  ADMIN_JWT_SECRET: string;
  API_KEY: string;
  // ほかのバインドがあれば追記
};

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "__missing__";

  const adminActions = new Set<string>([
    "listLeads",
    "exportLeads",
    "deleteLead",
    "listReservations",
    "listTenants",
  ]);

  // ===== 管理アクション（Cookie or x-admin-key）=====
  if (adminActions.has(action)) {
    const cookie = request.headers.get("cookie") ?? "";
    const cookies = parseCookies(cookie);
    const adminSession = cookies["admin_session"];

    let okByCookie = false;
    if (adminSession && env.ADMIN_JWT_SECRET) {
      try {
        const payload: any = await verifyToken(adminSession, env.ADMIN_JWT_SECRET);
        okByCookie = payload?.role === "admin";
      } catch {
        okByCookie = false;
      }
    }

    const headerKey = normalize(request.headers.get("x-admin-key"));
    const envKey = normalize(env.ADMIN_KEY);
    const okByHeader = !!envKey && !!headerKey && constantTimeEqual(headerKey, envKey);

    if (!okByCookie && !okByHeader) {
      return json({ ok: false, error: "unauthorized", need: "admin" }, 401, { "x-auth-mode": "admin" });
    }
    // 認可OK → 既存の管理処理へ
    return handleAdminAction(action, request, env);
  }

  // ===== それ以外は API トークン必須 =====
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !constantTimeEqual(normalize(token), normalize(env.API_KEY))) {
    return json({ ok: false, error: "unauthorized", need: "api" }, 401, { "x-auth-mode": "api" });
  }

  // 認証後の __echo__
  if (action === "__echo__") {
    const raw = await request.json().catch(() => ({} as any));
    return json(
      { ok: true, action, payload: (raw as any)?.payload ?? null, raw, tenant: "salon-booking-saas" },
      200,
      { "x-auth-mode": "api" },
    );
  }

  // それ以外の公開API
  return handlePublicAction(action, request, env);
}

// ===== ユーティリティ =====
function json(body: any, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function normalize(s: string | null | undefined) {
  return (s ?? "").replace(/[\r\n]+$/g, "").trim();
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function parseCookies(header: string) {
  const out: Record<string, string> = {};
  header.split(/;\s*/).forEach((kv) => {
    const [k, ...rest] = kv.split("=");
    if (!k) return;
    out[k] = decodeURIComponent(rest.join("=") || "");
  });
  return out;
}

// HMAC署名付きトークン（login.tsで発行）の検証
async function verifyToken(token: string, secret: string) {
  const [pEnc, sEnc] = token.split(".");
  if (!pEnc || !sEnc) throw new Error("bad token");
  const payloadBytes = b64urlDecode(pEnc);
  const payloadJson = new TextDecoder().decode(payloadBytes);
  const payload = JSON.parse(payloadJson);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes);
  const sigOk = constantTimeEqual(toB64url(new Uint8Array(sig)), sEnc);
  if (!sigOk) throw new Error("bad sig");

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) throw new Error("expired");

  return payload;
}

function toB64url(u8: Uint8Array) {
  let s = "";
  for (const x of u8) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(s: string) {
  const padLen = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 既存実装にバインド
declare function handleAdminAction(action: string, request: Request, env: Env): Promise<Response>;
declare function handlePublicAction(action: string, request: Request, env: Env): Promise<Response>;
