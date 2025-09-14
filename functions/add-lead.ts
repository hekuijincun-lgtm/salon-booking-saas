// functions/add-lead.ts
// 公開エンドポイント（トークン不要）: リードを UPSERT で保存
// 前提: D1 バインディング名は "DB"（env.DB）

type Env = {
  DB: D1Database;
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    // 0) D1 バインディング存在チェック
    if (!env.DB || typeof env.DB.prepare !== "function") {
      return json(
        { ok: false, error: "d1_binding_missing", need: "Functions > D1 binding name=DB" },
        500
      );
    }

    // 1) 入力をパース
    const body = await request.json().catch(() => null) as any;
    if (!body) return json({ ok: false, error: "bad_json" }, 400);

    const tenant  = String(body.tenant || "").trim();
    const name    = String(body.name   || "").trim();
    const email   = String(body.email  || "").trim().toLowerCase();
    const channel = String(body.channel|| "Email").trim();
    const note    = String(body.note   || "").trim();

    if (!tenant || !name || !email) {
      return json({ ok: false, error: "bad_request_missing_fields" }, 400);
    }

    // 2) 初回デプロイでも落ちないように作表（IF NOT EXISTS）
    //    マルチテナント想定で (tenant, email) をユニークに
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        tenant TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        channel TEXT,
        note TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(tenant, email)
      );
    `);

    // 3) UPSERT（tenant+email をキーに上書き）
    await env.DB
      .prepare(
        `
        INSERT INTO leads (id, tenant, name, email, channel, note, created_at)
        VALUES (hex(randomblob(16)), ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(tenant, email) DO UPDATE SET
          name=excluded.name,
          channel=excluded.channel,
          note=excluded.note,
          created_at=unixepoch()
        `
      )
      .bind(tenant, name, email, channel, note)
      .run();

    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: "exception", detail: String(e) }, 500);
  }
};
