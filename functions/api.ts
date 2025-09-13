// /functions/api.ts
// - 管理API: x-admin-key or admin_session(JWT) で認証
// - 公開API: 原則 Bearer 必須。ただし allowlist の "submitLead" は無認証で受け付ける
// - KV: Variable name=LEADS 推奨（誤名もフォールバック検出）
// - CSVはBOM付きUTF-8（Excel向け）

type Env = {
  ADMIN_KEY: string;
  ADMIN_JWT_SECRET: string;
  API_KEY: string;
  [k: string]: any;
};

const ADMIN_ACTIONS = new Set<string>([
  "listLeads",
  "exportLeads",
  "deleteLead",
  "addLeadDebug",
  "listReservations",
  "listTenants",
]);

// ← 公開で無認証許可するアクションのホワイトリスト
const PUBLIC_NOAUTH = new Set<string>([
  "submitLead",
]);

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  try {
    // CORS プリフライト簡易対応（必要なら）
    if (request.method === "OPTIONS") {
      return new Response("", {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST,OPTIONS",
          "access-control-allow-headers": "content-type,authorization,x-admin-key",
        },
      });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get("action") ?? "__missing__";

    // ① 管理アクション（x-admin-key or Cookie）
    if (ADMIN_ACTIONS.has(action)) {
      const ok = await isAdminAuthorized(request, env);
      if (!ok) return j({ ok: false, error: "unauthorized", need: "admin" }, 401, { "x-auth-mode": "admin" });
      try {
        return await handleAdminActionInline(action, request, env);
      } catch (err: any) {
        return j({ ok: false, error: "admin_action_failed", detail: String(err) }, 500);
      }
    }

    // ② 無認証で通す公開アクション（ホワイトリスト）
    if (PUBLIC_NOAUTH.has(action)) {
      return await handlePublicNoAuth(action, request, env);
    }

    // ③ それ以外の公開APIは Bearer 必須
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || !ctEq(norm(token), norm(env.API_KEY))) {
      return j({ ok: false, error: "unauthorized", need: "api" }, 401, { "x-auth-mode": "api" });
    }

    // ④ 認証後の公開API
    if (action === "__echo__") {
      const raw = await readJson(request).catch(() => ({} as any));
      return j(
        { ok: true, action, payload: (raw as any)?.payload ?? null, raw, tenant: "salon-booking-saas" },
        200,
        { "x-auth-mode": "api" },
      );
    }

    return j({ ok: false, error: "unknown_action", action }, 404);
  } catch (err: any) {
    return j({ ok: false, error: "unhandled_exception", detail: String(err) }, 500);
  }
}

/* ============ 公開: 無認証アクション ============ */

async function handlePublicNoAuth(action: string, request: Request, env: Env): Promise<Response> {
  switch (action) {
    case "submitLead": {
      const body = await readJson(request).catch(() => ({} as any));
      const tenant = String(body?.tenant || "salon-booking-saas");
      const name   = clampStr(String(body?.name || "").trim(), 1, 100);
      const email  = String(body?.email || "").trim();
      const channel= clampStr(String(body?.channel || ""), 0, 40);
      const note   = clampStr(String(body?.note || ""), 0, 2000);
      const toolId = String(body?.toolId || "tool_salon_booking_v1");

      if (!name)  return j({ ok:false, error:"name_required" }, 400);
      if (!isEmail(email)) return j({ ok:false, error:"email_invalid" }, 400);

      const KV = getLeadsBinding(env);
      if (!KV) return j({ ok:false, error:"no_kv", need:"Bind KV namespace as LEADS" }, 500);

      // 既存メールの簡易重複チェック（下記キーでインデックス）
      const emailIdxKey = emailIndexKey(tenant, email.toLowerCase());
      let id = await KV.get(emailIdxKey);
      const now = new Date().toISOString();

      if (!id) {
        id = uuid();
        await KV.put(emailIdxKey, id);
      }

      const item = {
        id, toolId, name, email,
        channel, note,
        createdAt: now,
        tenant,
      };

      await KV.put(leadKey(tenant, id), JSON.stringify(item));
      return j({ ok:true, id });
    }
    default:
      return j({ ok:false, error:"unknown_public_action", action }, 404);
  }
}

/* ============ 管理アクション（インライン実装） ============ */

async function handleAdminActionInline(action: string, request: Request, env: Env): Promise<Response> {
  switch (action) {
    case "listLeads": {
      const { tenant } = await readJson(request).catch(() => ({ tenant: "" }));
      const items = await listLeadsFromStore(env, tenant);
      return j({ ok: true, items });
    }
    case "exportLeads": {
      const { tenant } = await readJson(request).catch(() => ({ tenant: "" }));
      const items = await listLeadsFromStore(env, tenant);
      const csv = toCSV(items);
      const csvBody = "\uFEFF" + csv; // BOM
      return new Response(csvBody, {
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
      const KV = getLeadsBinding(env);
      if (!KV || typeof KV.put !== "function") {
        return j({ ok: false, error: "no_kv", need: "Bind KV namespace as LEADS" }, 500);
        }
      const { tenant } = await readJson(request).catch(() => ({ tenant: "" }));
      const t = tenant || "salon-booking-saas";
      const id = uuid();
      const now = new Date().toISOString();
      const item = {
        id, toolId: "tool_salon_booking_v1", name: "デモリード",
        email: `demo+${id}@example.com`, createdAt: now, tenant: t,
      };
      await KV.put(leadKey(t, id), JSON.stringify(item));
      return j({ ok: true, item });
    }
    case "listReservations": {
      return j({ ok: true, items: [] });
    }
    case "listTenants": {
      return j({ ok: true, items: tenantCandidatesFromEnv(env) });
    }
    default:
      return j({ ok: false, error: "unknown_admin_action", action }, 400);
  }
}

/* ===================== 認証/共通ユーティリティ ===================== */

function j(body: any, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...extra,
    },
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

function parseCookies(h: string | null | undefined) {
  const out: Record<string, string> = {};
  (h ?? "")
    .split(/;\s*/)
    .filter(Boolean)
    .forEach((kv) => {
      const [k, ...r] = kv.split("=");
      if (!k) return;
      out[k] = decodeURIComponent(r.join("=") || "");
    });
  return out;
}

async function isAdminAuthorized(request: Request, env: Env) {
  // 1) ヘッダ x-admin-key
  const hdr = norm(request.headers.get("x-admin-key"));
  const envKey = norm(env.ADMIN_KEY);
  if (hdr && envKey && hdr.length === envKey.length && ctEq(hdr, envKey)) return true;

  // 2) Cookie admin_session（HMAC-SHA256署名トークン）
  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies["admin_session"];
  if (!token || !env.ADMIN_JWT_SECRET) return false;

  try {
    const payload: any = await verifyToken(token, env.ADMIN_JWT_SECRET);
    const now = Math.floor(Date.now() / 1000);
    return payload?.role === "admin" && (!payload.exp || payload.exp > now);
  } catch {
    return false;
  }
}

// HMAC-SHA256トークン検証（/functions/admin/login.ts と対）
async function verifyToken(token: string, secret: string) {
  const [pEnc, sEnc] = token.split(".");
  if (!pEnc || !sEnc) throw new Error("bad token format");
  const payloadBytes = b64urlDecode(pEnc);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes);
  if (!ctEq(toB64url(new Uint8Array(sig)), sEnc)) throw new Error("bad signature");
  return JSON.parse(new TextDecoder().decode(payloadBytes));
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

async function readJson(req: Request) {
  if (!((req.headers.get("content-type") || "").includes("application/json"))) return {};
  return await req.json();
}

function clampStr(s: string, min: number, max: number) {
  const t = (s || "").slice(0, max);
  return t.length < min ? "" : t;
}

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/* ===================== KV ヘルパ ===================== */

function getLeadsBinding(env: any) {
  const candidates = ["LEADS", "salon-leads-prod", "salon_leads_prod", "leads", "LEADS_PROD"];
  for (const k of candidates) {
    const v = env?.[k];
    if (v && (typeof v.get === "function" || typeof v.list === "function" || typeof v.put === "function")) {
      return v;
    }
  }
  return undefined;
}

function leadKey(tenant: string, id: string) {
  const t = tenant || "salon-booking-saas";
  return `lead:${t}:${id}`;
}
function emailIndexKey(tenant: string, emailLower: string) {
  const t = tenant || "salon-booking-saas";
  return `lead_email_index:${t}:${emailLower}`;
}

async function listLeadsFromStore(env: Env, tenant: string) {
  const KV = getLeadsBinding(env);
  if (!KV || typeof KV.list !== "function" || typeof KV.get !== "function") return [] as any[];
  const prefix = `lead:${tenant || "salon-booking-saas"}:`;
  const out: any[] = [];
  let cursor: string | undefined = undefined;

  do {
    const res = await KV.list({ prefix, cursor });
    for (const k of res.keys ?? []) {
      const raw = await KV.get(k.name).catch(() => null);
      if (!raw) continue;
      try { out.push(JSON.parse(raw)); } catch {}
    }
    cursor = res.cursor;
    if (res.list_complete) break;
  } while (cursor);

  return out;
}

async function deleteLeadFromStore(env: Env, tenant: string, id: string) {
  const KV = getLeadsBinding(env);
  if (!KV || typeof KV.delete !== "function") return;
  await KV.delete(leadKey(tenant, id)).catch(() => {});
  // メールインデックス消すなら、このIDのemailを読んで照合が必要（今回は省略）
}

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

function uuid() {
  const u8 = new Uint8Array(16);
  crypto.getRandomValues(u8);
  u8[6] = (u8[6] & 0x0f) | 0x40;
  u8[8] = (u8[8] & 0x3f) | 0x80;
  const hex = [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
