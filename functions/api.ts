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
    headers: { "content-type": "applic
