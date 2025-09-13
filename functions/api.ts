// /functions/api.ts — 管理は「Cookie or x-admin-key」、一般は「APIトークン」必須
// __echo__ は「認証後」に実行

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;

  // action 取得
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "__missing__";

  // 管理アクション一覧
  const adminActions = new Set<string>([
    "listLeads",
    "exportLeads",
    "deleteLead",
    "listReservations",
    "listTenants",
  ]);

  // === ① 管理アクション：まず Cookie（admin_session）を優先 ===
  if (adminActions.has(action)) {
    const cookie = request.headers.get("cookie") ?? "";
    const ses = parseCookie(cookie)["admin_session"];
    if (ses && (await verifyToken(ses, env.ADMIN_JWT_SECRET))) {
      // CookieセッションでOK
      return handleAdminAction(action, request, env);
    }

    // Cookieが無効なら、x-admin-key でも許可（CLI/サーバ間向け）
    const adminKey = request.headers.get("x-admin-key") ?? "";
    if (!__tse(adminKey, env.ADMIN_KEY)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized", need: "admin" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8", "x-auth-mode": "admin" },
      });
    }
    return handleAdminAction(action, request, env);
  }

  // === ② 一般アクションは APIトークン必須 ===
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !__tse(token, env.API_KEY)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized", need: "api" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "x-auth-mode": "api" },
    });
  }

  // === ③ 認証後ハンドリング（__echo__ もここで処理） ===
  if (action === "__echo__") {
    const raw = await request.json().catch(() => ({} as any));
    return new Response(
      JSON.stringify({ ok: true, action, payload: (raw as any)?.payload ?? null, raw, tenant: "salon-booking-saas" }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8", "x-auth-mode": "api" } },
    );
  }

  // === ④ 既存の公開APIへ委譲 ===
  return handlePublicAction(action, request, env);
}

/* ===== ユーティリティ ===== */

// タイミング安全な等価比較（キー比較用）
function __tse(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Cookie 文字列を {name:value} にパース
function parseCookie(c: string) {
  const out: Record<string, string> = {};
  c.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// admin_session の検証（HMAC-SHA256 / base64url）
// 形式: "<payload_b64url>.<sig_b64url>"
// payload 例: { role:"admin", iat:..., exp:... }
async function verifyToken(token: string, secret: string) {
  const [p, s] = token.split(".");
  if (!p || !s) return false;

  const data = b64urlToBytes(p);
  const sig = b64urlToBytes(s);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  const ok = await crypto.subtle.verify("HMAC", key, sig, data);
  if (!ok) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(data));
    const now = Math.floor(Date.now() / 1000);
    return payload?.role === "admin" && typeof payload?.exp === "number" && payload.exp >= now;
  } catch {
    return false;
  }
}

// base64url → Uint8Array
function b64urlToBytes(str: string): Uint8Array {
  const pad = (s: string) => s + "===".slice((s.length + 3) % 4);
  const b64 = pad(str.replace(/-/g, "+").replace(/_/g, "/"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ===== 型 & 既存ハンドラ宣言 ===== */
type Env = {
  ADMIN_KEY: string;
  API_KEY: string;
  ADMIN_JWT_SECRET: string; // ★ 追加：Cookie検証用シークレット
  // 他にKV/DB等のバインドがあればここに追記
};

declare function handleAdminAction(action: string, request: Request, env: Env): Promise<Response>;
declare function handlePublicAction(action: string, request: Request, env: Env): Promise<Response>;
