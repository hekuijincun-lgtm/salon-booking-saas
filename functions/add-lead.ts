// functions/add-lead.ts
// 公開エンドポイント（トークン不要）: リードを UPSERT 保存
// D1: env.DB を使用。テーブル作成は単文ずつ .prepare().run() で安全に。

type Env = { DB: D1Database };

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB || typeof env.DB.prepare !== "function") {
      return json({ ok: false, error: "d1_binding_missing", need: "Functions > D1 binding name=DB" }, 500);
    }

    const b = await request.json().catch(() => null) as any;
    if (!b) return json({ ok: false, error: "bad_json" }, 400);

    const tenant  = String(b.tenant || "").trim();
    const name    = String(b.name   || "").trim();
    const email   = String(b.email  || "").trim().toLowerCase();
    const channel = String(b.channel|| "Email").trim();
    const note    = String(b.note   || "").trim();
    if (!tenant || !name || !email) {
      return json({ ok: false, error: "bad_request_missing_fields" }, 400);
    }

    // --- schema: CREATE TABLE(単文) ＋ UNIQUE INDEX(単文) ---
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS leads (
         id         TEXT PRIMARY KEY,
         tenant     TEXT NOT NULL,
         name       TEXT NOT NULL,
         email      TEXT NOT NULL,
         channel    TEXT,
         note       TEXT,
         created_at INTEGER NOT NULL
       )`
    ).run();

    // (tenant, email) を一意化（UPSERTの衝突ターゲット用）
    await env.DB.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email
         ON leads (tenant, email)`
    ).run();

    // --- upsert ---
    await env.DB.prepare(
      `INSERT INTO leads (id, tenant, name, email, channel, note, created_at)
       VALUES (hex(randomblob(16)), ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(tenant, email) DO UPDATE SET
         name=excluded.name,
         channel=excluded.channel,
         note=excluded.note,
         created_at=unixepoch()`
    ).bind(tenant, name, email, channel, note).run();

    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: "exception", detail: String(e) }, 500);
  }
};
