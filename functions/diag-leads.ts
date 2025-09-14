// functions/diag-leads.ts
// 診断用の簡易一覧（Adminトークン必須）: GET /diag-leads?tenant=xxx
// 前提: D1 バインディング名 "DB"、環境変数 "ADMIN_TOKEN"

type Env = {
  DB: D1Database;
  ADMIN_TOKEN: string;
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // 認証（固定ベアラー）
  const need = "Bearer " + (env.ADMIN_TOKEN || "");
  const got = request.headers.get("authorization") || "";
  if (!env.ADMIN_TOKEN || got !== need) {
    return json({ ok: false, error: "unauthorized", need: "admin" }, 401);
  }

  try {
    if (!env.DB || typeof env.DB.prepare !== "function") {
      return json({ ok: false, error: "d1_binding_missing" }, 500);
    }

    const url = new URL(request.url);
    const tenant = (url.searchParams.get("tenant") || "salon-booking-saas").trim();

    // 表が無いケースでもエラーにせず空配列を返したいので存在確認→無ければ空返却
    const tableCheck = await env.DB
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='leads'`
      )
      .all();

    if (!tableCheck?.results?.length) {
      return json({ ok: true, items: [] });
    }

    const { results } = await env.DB
      .prepare(
        `
        SELECT id, tenant, name, email, channel, note, created_at
        FROM leads
        WHERE tenant = ?
        ORDER BY created_at DESC
        LIMIT 100
        `
      )
      .bind(tenant)
      .all();

    return json({ ok: true, items: results || [] });
  } catch (e: any) {
    return json({ ok: false, error: "exception", detail: String(e) }, 500);
  }
};
