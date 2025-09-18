interface Env {
  DB: D1Database;
  ADMIN_TOKEN?: string; ADMIN_KEY?: string; ADMIN?: string;
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function readToken(req: Request): string | null {
  const h = req.headers;
  const auth = h.get("authorization") || h.get("Authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return h.get("x-api-key") || h.get("X-API-KEY");
}

function getAdminSecret(env: Env): string | null {
  return env.ADMIN_TOKEN || env.ADMIN_KEY || env.ADMIN || null;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const token = readToken(request);
  const admin = getAdminSecret(env);
  if (!token || !admin || token !== admin) return json({ ok: false, error: "unauthorized", need: "admin" }, 401);

  // 1ステートメントずつ（multi-stmt回避）
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
  `);
  await env.DB.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_email
      ON leads (tenant, email);
  `);

  return json({ ok: true, action: "init" });
};
