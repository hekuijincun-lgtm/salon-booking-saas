// /functions/api.ts — 管理は Cookie or x-admin-key、公開APIは Bearer 必須（1101回避のtry/catch付き）
type Env = {
  ADMIN_KEY: string;
  ADMIN_JWT_SECRET: string;
  API_KEY: string;
  // 他のバインドがあれば追記
};

// 管理アクション一覧（必要に応じて追加）
const ADMIN_ACTIONS = new Set<string>([
  "listLeads",
  "exportLeads",
  "deleteLead",
  "listReservations",
  "listTenants",
]);

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") ?? "__missing__";

    // ===== 管理アクション：Cookie（admin_session） or ヘッダ x-admin-key =====
    if (ADMIN_ACTIONS.has(action)) {
      const ok = await isAdminAuthorized(request, env);
      if (!ok) {
        return j({ ok: false, error: "unauthorized", need: "admin" }, 401, { "x-auth-mode": "admin" });
      }
      // 既存の管理処理へ（例外は捕捉して1101回避）
      try {
        return await handleAdminAction(action, request, env);
      } catch (err: any) {
        return j({ ok: false, error: "admin_action_failed", detail: String(err) }, 500);
      }
    }

    // ===== 公開API：Authorization: Bearer <API_KEY> 必須 =====
    const auth = request.headers.get("authorization") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!bearer || !ctEq(norm(bearer), norm(env.API_KEY))) {
      return j({ ok: false, error: "unauthorized", need: "api" }, 401, { "x-auth-mode": "api" });
    }

    // 認証後の __echo__
    if (action === "__echo__") {
      const raw = await request.json().catch(() => ({} as any));
      return j({ ok: true, action, payload: (raw as any)?.payload ?? null, raw, tenant: "salon-booking-saas" }, 200, {
        "x-auth-mode": "api",
      });
    }

    // その他の公開API（例外は捕捉して1101回避）
    try {
      return await handlePublicAction(action, request, env);
    } catch (err: any) {
      return j({ ok: false, error: "public_action_failed", detail: String(err) }, 500);
    }
  } catch (err: any) {
    // 最後の砦：どんな例外も1101にせずJSONで返す
    return j({ ok: false, error: "unhandled_exception", detail: String(err) }, 500);
  }
}

/* ================= ユーティリティ ================= */

function j(body: any, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

function norm(s: string | null | undefined) {
  return (s ?? "").replace(/[\r\n]+$/g, "").trim();
}

function ctEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function parseCookies(header: string | null | undefined) {
  const out: Record<string, string> = {};
  (header ?? "")
    .split(/;\s*/)
    .filter(Boolean)
    .forEach((kv) => {
      const [k, ...rest] = kv.split("=");
      if (!k) return;
      out[k] = decodeURIComponent(rest.join("=") || "");
    });
  return out;
}

async function isAdminAuthorized(request: Request, env: Env) {
  // 1) ヘッダ優先（normalizeで改行吸収）
  const hdr = norm(request.headers.get("x-admin-key"));
  const envKey = norm(env.ADMIN_KEY);
  if (hdr && envKey && hdr.length === envKey.length && ctEq(hdr, envKey)) {
    return true;
  }

  // 2) Cookie(admin_session) 検証
  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies["admin_session"];
  if (!token || !env.ADMIN_JWT_SECRET) return false;

  try {
    const payload: any = await verifyToken(token, env.ADMIN_JWT_SECRET);
    return payload?.role === "admin" && (!payload.exp || payload.exp > Math.floor(Date.now() / 1000));
  } catch {
    return false;
  }
}

// login.ts の makeToken と対になる簡易トークン検証：payloadB64url.sigB64url（HMAC-SHA256）
async function verifyToken(token: string, secret: string) {
  const [pEnc, sEnc] = token.split(".");
  if (!pEnc || !sEnc) throw new Error("bad token format");

  const payloadBytes = b64urlDecode(pEnc);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes);
  const ok = ctEq(toB64url(new Uint8Array(sig)), sEnc);
  if (!ok) throw new Error("bad signature");

  const payloadJson = new TextDecoder().decode(payloadBytes);
  return JSON.parse(payloadJson);
}

function toB64url(u8: Uint8Array) {
  let s = "";
  for (const x of u8) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(s: string) {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ========= 既存実装へのバインド（元の実装を呼び出す） ========= */
// ここは “宣言” だけ。実体は既存ファイル側にある前提（Pages Functions がリンクする）
declare function handleAdminAction(action: string, request: Request, env: Env): Promise<Response>;
declare function handlePublicAction(action: string, request: Request, env: Env): Promise<Response>;

