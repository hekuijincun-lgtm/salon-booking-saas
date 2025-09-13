// /functions/api.ts — 管理は Cookie or x-admin-key、公開APIは Bearer 必須（1101回避）
// 管理側: listLeads/exportLeads/deleteLead/addLeadDebug を内蔵
// ストレージ: Cloudflare KV "LEADS"（未バインドなら空配列 or エラーで返す）

type Env = {
  ADMIN_KEY: string;
  ADMIN_JWT_SECRET: string;
  API_KEY: string;
  LEADS?: {
    get: (key: string) => Promise<string | null>;
    put?: (key: string, value: string) => Promise<void>;
    delete?: (key: string) => Promise<void>;
    list?: (opts?: { prefix?: string; limit?: number; cursor?: string }) => Promise<{
      keys: Array<{ name: string }>;
      list_complete: boolean;
      cursor?: string;
    }>;
  };
};

// 管理アクション一覧（必要に応じて追加）
const ADMIN_ACTIONS = new Set<string>([
  "listLeads",
  "exportLeads",
  "deleteLead",
  "addLeadDebug",       // ← デモ用：KVに1件投入
  "listReservations",   // ダミー
  "listTenants",        // ダミー
]);

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") ?? "__missing__";

    // ===== 管理アクション：Cookie（admin_session） or ヘッダ x-admin-key =====
    if (ADMIN_ACTIONS.has(action)) {
      const ok = await isAdminAuthorized(request, env);
      if (!ok) return j({ ok: false, error: "unauthorized", need: "admin" }, 401, { "x-auth-mode": "admin" });

      try {
        return await handleAdminActionInline(action, request, env);
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

    // 未対応アクション
    return j({ ok: false, error: "unknown_action", action }, 404);
  } catch (err: any) {
    // 最後の砦：どんな例外も1101にせずJSONで返す
    return j({ ok: false, error: "unhandled_exception", detail: String(err) }, 500);
  }
}

/* ================= 管理ハンドラ（インライン実装） ================= */

async function handleAdminActionInline(action: string, request: Request, env: Env): Promise<Response> {
  switch (action) {
    case "listLeads": {
      const { tenant } = await readJson(request).catch(() => ({ tenant: "" as string }));
      const items = await listLeadsFromStore(env, tenant);
      return j({ ok: true, items });
    }

    case "exportLeads": {
      const { tenant } = await readJson(request).catch(() => ({ tenant: "" as string }));
      const items = await listLeadsFromStore(env, tenant);
      const csv = toCSV(items);
      return new Response(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="leads_${tenant || "default"}.csv"`,
        },
      });
    }

    case "deleteLead": {
      const { tenant, id } = await readJson(request).catch(() => ({ tenant: "", id: "" }));
      if (!id) return j({ ok: false, error: "missing id" }, 400);
      await deleteLeadFromStore(env, tenant, id);
      return j({ ok: true });
    }

    case "addLeadDebug": {
      // デモ用：1件だけ投入（KVが無ければエラー）
      if (!env.LEADS || typeof env.LEADS.put !== "function") {
        return j({ ok: false, error: "no_kv", need: "Bind KV namespace as LEADS" }, 500);
      }
      const { tenant } = await readJson(request).catch(() => ({ tenant: "" as string }));
      const t = tenant || "salon-booking-saas";
      const id = uuid();
      const now = new Date().toISOString();
      const obj = {
        id,
        toolId: "tool_salon_booking_v1",
        name: "デモリード",
        email: `demo+${id}@example.com`,
        createdAt: now,
        tenant: t,
      };
      await env.LEADS.put(leadKey(t, id), JSON.stringify(obj));
      return j({ ok: true, item: obj });
    }

    // ダミー実装（必要なら拡張）
    case "listReservations":
      return j({ ok: true, items: [] });

    case "listTenants":
      return j({ ok: true, items: tenantCandidatesFromEnv(env) });

    default:
      return j({ ok: false, error: "unknown_admin_action", action }, 400);
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
  // 1) ヘッダ（normalizeで改行吸収）
  const hdr = norm(request.headers.get("x-admin-key"));
  const envKey = norm(env.ADMIN_KEY);
  if (hdr && envKey && hdr.length === envKey.length && ctEq(hdr, envKey)) return true;

  // 2) Cookie(admin_session)
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

async function readJson(req: Request): Promise<any> {
  if (!(req.headers.get("content-type") || "").includes("application/json")) return {};
  return await req.json();
}

/* ====== 簡易ストレージ層（KV: LEADS があれば利用。無ければ空配列） ====== */

function leadKey(tenant: string, id: string) {
  const t = tenant || "salon-booking-saas";
  return `lead:${t}:${id}`;
}

async function listLeadsFromStore(env: Env, tenant: string) {
  if (!env.LEADS || typeof env.LEADS.list !== "function" || typeof env.LEADS.get !== "function") {
    return [] as any[]; // KV未バインドなら空配列
  }
  const prefix = `lead:${tenant || "salon-booking-saas"}:`;
  const out: any[] = [];
  let cursor: string | undefined = undefined;

  do {
    const res = await env.LEADS.list!({ prefix, cursor });
    for (const k of res.keys) {
      const raw = await env.LEADS.get(k.name);
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw));
      } catch { /* noop */ }
    }
    cursor = res.cursor;
    if (res.list_complete) break;
  } while (cursor);

  return out;
}

async function deleteLeadFromStore(env: Env, tenant: string, id: string) {
  if (!env.LEADS || typeof env.LEADS.delete !== "function") return;
  await env.LEADS.delete!(leadKey(tenant, id)).catch(() => {});
}

// シンプルCSV（カンマ/改行のエスケープ最小対応）
function toCSV(rows: any[]) {
  const header = ["id", "toolId", "name", "email", "createdAt"];
  const esc = (s: any) => {
    const t = String(s ?? "");
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [header.join(",")];
  for (const r of rows) lines.push(header.map((h) => esc((r as any)[h])).join(","));
  return lines.join("\n");
}

function tenantCandidatesFromEnv(_env: Env) {
  return [{ id: "salon-booking-saas", name: "Salon Booking" }];
}

// 乱数UUID（簡易）
function uuid() {
  const u8 = new Uint8Array(16);
  crypto.getRandomValues(u8);
  u8[6] = (u8[6] & 0x0f) | 0x40; // version 4
  u8[8] = (u8[8] & 0x3f) | 0x80; // variant
  const hex = [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
