// functions/init-db.ts
// Admin 専用: leads テーブルと UNIQUE INDEX を作るだけの初期化エンドポイント
type Env = { DB: D1Database; ADMIN_TOKEN: string };

const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 認証
  const need = "Bearer " + (env.ADMIN_TOKEN || "");
  if (!env.ADMIN_TOKEN || request.headers.get("authorization") !== need) {
    return json({ ok: false, error: "unauthorized", need: "admin" }, 401);
  }

  try {
    if (!env.DB || typeof env.DB.prepare !== "function") {
      return json({ ok: false, error: "d1_binding_missing", need: "Functions > D1 binding name=DB" }, 500);
    }

    // --- 単文・一行で安全に初期化 ---
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, channel TEXT, note TEXT, created_at INTEGER NOT NULL)"
    ).run();

    await env.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email ON leads (tenant, email)"
    ).run();

    return json({ ok: true, action: "init" });
  } catch (e: any) {
    return json({ ok: false, error: "exception", detail: String(e) }, 500);
  }
};
