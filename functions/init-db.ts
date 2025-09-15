// /functions/init-db.ts
export interface Env { DB: D1Database; }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        tenant TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        channel TEXT,
        note TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email
        ON leads (tenant, email);
    `);
    return new Response(JSON.stringify({ ok: true, action: "init" }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: "exception", detail: String(e?.message || e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
